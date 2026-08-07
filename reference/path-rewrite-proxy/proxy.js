#!/usr/bin/env node
'use strict';

// ============================================================================
// chat-path-rewrite-proxy —— LLM 网关双入口代理（reference implementation）
//
//   入口 A（Codex/ccx 等 OpenAI 客户端）：/v1/chat/completions 等 → 纯 path-rewrite 透传
//     标准 OpenAI Chat，只改路径(/v1→/prefix)+注 Bearer+可选 model 重写。
//
//   入口 B（Claude Code 等 Anthropic 客户端）：/v1/messages → Anthropic→Chat 全翻译
//     Anthropic Messages 协议 → OpenAI Chat 协议（含 system/tool_use/tool_result/
//     tools/tool_choice），再回译响应（非流式 JSON + SSE 流式），无需外部翻译层。
//     /v1/messages/count_tokens → 轻量估算（Claude Code 上下文条用）。
//
// 上游统一：LLM 网关 GATEWAY_BASE_URL + GATEWAY_PATH_PREFIX + /chat/completions
// 存在理由：企业/自建网关常把 OpenAI 端点暴露在【非标准路径前缀】(如 /v1/model/...)，
//           通用翻译层硬编码 /v1/chat/completions 会得到伪装成 "provider not found" 的 404。
// ============================================================================

const GATEWAY_BASE_URL    = process.env.GATEWAY_BASE_URL;
const GATEWAY_PATH_PREFIX = process.env.GATEWAY_PATH_PREFIX || '/v1/model';
const GATEWAY_MODEL       = process.env.GATEWAY_MODEL || '';   // 空 = 不强制重写，透传请求原 model
const GATEWAY_API_KEY     = process.env.GATEWAY_API_KEY;
const PROXY_PORT          = parseInt(process.env.PROXY_PORT || '8423', 10);
const BIND_HOST           = process.env.BIND_HOST || '127.0.0.1';
const DEBUG               = process.env.DEBUG === '1';

if (!GATEWAY_BASE_URL) { console.error('[proxy] FATAL: GATEWAY_BASE_URL not set'); process.exit(1); }
if (!GATEWAY_API_KEY)  { console.error('[proxy] FATAL: GATEWAY_API_KEY not set');  process.exit(1); }

const http  = require('http');
const https = require('https');

const UPSTREAM_URL  = new URL(GATEWAY_BASE_URL);
const UPSTREAM_MOD  = UPSTREAM_URL.protocol === 'http:' ? http : https;   // 生产=https；mock=http 本机验
const UPSTREAM_PORT = UPSTREAM_URL.port || (UPSTREAM_URL.protocol === 'http:' ? 80 : 443);
const UPSTREAM_CHAT = GATEWAY_PATH_PREFIX + '/chat/completions';   // /v1/model/chat/completions
const dbg = (...a) => { if (DEBUG) console.error('[proxy]', ...a); };

// ── OpenAI passthrough (Codex/ccx) —— 只改路径 ─────────────────────────────
const PATH_WHITELIST = new Set(['/v1/chat/completions', '/v1/embeddings', '/v1/models']);
let MODEL_REWRITE = {};
if (process.env.MODEL_REWRITE_MAP) { try { MODEL_REWRITE = JSON.parse(process.env.MODEL_REWRITE_MAP); } catch (_) {} }

function rewritePath(p) {
  const pathOnly = p.split('?')[0];
  if (!PATH_WHITELIST.has(pathOnly)) return p;
  if (!GATEWAY_PATH_PREFIX) return p;
  return GATEWAY_PATH_PREFIX + pathOnly.slice(3);   // /v1/X → /prefix/X
}

function handlePassthrough(req, res) {
  const newPath = rewritePath(req.url);
  const query   = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const headers = { ...req.headers };
  headers['authorization'] = 'Bearer ' + GATEWAY_API_KEY;
  headers['host']          = UPSTREAM_URL.host;
  delete headers['proxy-connection'];
  delete headers['proxy-authorization'];

  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    if (body && PATH_WHITELIST.has(req.url.split('?')[0])) {
      try {
        const j = JSON.parse(body);
        dbg('passthrough model=' + (j.model || '?') + ' tools=' + (j.tools ? j.tools.length : 0));
        if (GATEWAY_MODEL && j.model)                  { j.model = GATEWAY_MODEL; body = JSON.stringify(j); headers['content-length'] = String(Buffer.byteLength(body)); }
        else if (j.model && MODEL_REWRITE[j.model])    { j.model = MODEL_REWRITE[j.model]; body = JSON.stringify(j); headers['content-length'] = String(Buffer.byteLength(body)); }
      } catch (_) {}
    }
    const upstream = UPSTREAM_MOD.request({
      hostname: UPSTREAM_URL.hostname, port: UPSTREAM_PORT,
      path: newPath + query, method: req.method, headers, timeout: 300000,
    }, up => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
    upstream.on('timeout', () => { upstream.destroy(); if (!res.headersSent) { res.writeHead(504); res.end('timeout'); } });
    upstream.on('error', e => { dbg('upstream error: ' + e.message); if (!res.headersSent) { res.writeHead(502); res.end(JSON.stringify({ error: { message: e.message } })); } });
    if (body) upstream.write(body);
    upstream.end();
  });
}

// ── Anthropic → OpenAI Chat 请求翻译 ───────────────────────────────────────
function textFromBlocks(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(b => b && b.type === 'text').map(b => b.text || '').join('');
}

// tool_result.content 可为 string 或 [{type:text|image,...}]
function toolResultText(block) {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map(x => {
      if (typeof x === 'string') return x;
      if (x && x.type === 'text') return x.text || '';
      if (x && x.type === 'image') return '[image omitted]';
      return '';
    }).join('');
  }
  return c == null ? '' : JSON.stringify(c);
}

function anthropicToChat(areq) {
  const msgs = [];

  // system → 首条 system 消息
  if (areq.system) {
    const sys = typeof areq.system === 'string' ? areq.system : textFromBlocks(areq.system);
    if (sys) msgs.push({ role: 'system', content: sys });
  }

  for (const m of (areq.messages || [])) {
    if (typeof m.content === 'string') { msgs.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) { msgs.push({ role: m.role, content: String(m.content ?? '') }); continue; }

    if (m.role === 'assistant') {
      const text = textFromBlocks(m.content);
      const toolCalls = m.content.filter(b => b && b.type === 'tool_use').map(b => ({
        id: b.id, type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input || {}) },
      }));
      const out = { role: 'assistant', content: text };
      if (toolCalls.length) out.tool_calls = toolCalls;
      msgs.push(out);
    } else {
      // user 轮：tool_result → 各自独立 role:tool 消息（紧跟 assistant tool_calls）；剩余 text → user
      const toolResults = m.content.filter(b => b && b.type === 'tool_result');
      for (const tr of toolResults) {
        msgs.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: toolResultText(tr) || '' });
      }
      const text = textFromBlocks(m.content);
      if (text) msgs.push({ role: 'user', content: text });
      // user 轮里若有 image 块，这里丢弃（部分 chat 后端不吃 Anthropic image 块）
    }
  }

  const creq = {
    model: GATEWAY_MODEL || areq.model,
    messages: msgs,
    max_tokens: areq.max_tokens || 4096,
    stream: !!areq.stream,
  };
  if (areq.temperature != null) creq.temperature = areq.temperature;
  if (areq.top_p != null) creq.top_p = areq.top_p;
  if (Array.isArray(areq.stop_sequences) && areq.stop_sequences.length) creq.stop = areq.stop_sequences;

  if (Array.isArray(areq.tools) && areq.tools.length) {
    creq.tools = areq.tools
      .filter(t => t && t.name)                      // 跳过 server-side 工具（无 input_schema 的特殊类型）
      .map(t => ({ type: 'function', function: { name: t.name, description: t.description || '', parameters: t.input_schema || { type: 'object', properties: {} } } }));
    if (areq.tool_choice) {
      const tc = areq.tool_choice;
      if (tc.type === 'auto') creq.tool_choice = 'auto';
      else if (tc.type === 'any') creq.tool_choice = 'required';
      else if (tc.type === 'tool' && tc.name) creq.tool_choice = { type: 'function', function: { name: tc.name } };
      else if (tc.type === 'none') creq.tool_choice = 'none';
    }
  }
  return creq;
}

// ── OpenAI Chat → Anthropic 响应回译（非流式）──────────────────────────────
const STOP_MAP = { stop: 'end_turn', tool_calls: 'tool_use', length: 'max_tokens', content_filter: 'end_turn' };

function chatToAnthropic(cresp, reqModel) {
  const choice  = (cresp.choices && cresp.choices[0]) || {};
  const message = choice.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const tc of (message.tool_calls || [])) {
    let input = {};
    try { input = JSON.parse(tc.function.arguments || '{}'); } catch (_) { input = {}; }
    content.push({ type: 'tool_use', id: tc.id || ('toolu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), name: tc.function.name, input });
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  const usage = cresp.usage || {};
  return {
    id: cresp.id || ('msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)),
    type: 'message', role: 'assistant', model: reqModel,
    content,
    stop_reason: STOP_MAP[choice.finish_reason] || 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 },
  };
}

// ── SSE 流式回译：OpenAI Chat SSE → Anthropic SSE ──────────────────────────
function streamChatToAnthropic(up, res, reqModel, estInputTokens) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive' });
  const send = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');

  let started = false, finished = false;
  let nextIndex = -1;                 // 当前 Anthropic content block index
  let openType = null;                // 'text' | 'tool'
  const seenTool = new Set();         // 见过的 OpenAI tool_call index
  let finishReason = 'stop';
  let outTokens = 0;
  const msgId = 'msg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function ensureStart() {
    if (started) return;
    started = true;
    send('message_start', { type: 'message_start', message: {
      id: msgId, type: 'message', role: 'assistant', model: reqModel,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: estInputTokens, output_tokens: 0 },
    }});
  }
  function closeBlock() {
    if (openType != null) { send('content_block_stop', { type: 'content_block_stop', index: nextIndex }); openType = null; }
  }
  function openText() { closeBlock(); nextIndex++; openType = 'text'; send('content_block_start', { type: 'content_block_start', index: nextIndex, content_block: { type: 'text', text: '' } }); }
  function openTool(id, name) { closeBlock(); nextIndex++; openType = 'tool'; send('content_block_start', { type: 'content_block_start', index: nextIndex, content_block: { type: 'tool_use', id: id || ('toolu_' + nextIndex), name: name || '', input: {} } }); }

  function processDelta(obj) {
    ensureStart();
    const choice = (obj.choices && obj.choices[0]) || {};
    const delta  = choice.delta || {};
    if (choice.finish_reason) finishReason = choice.finish_reason;
    if (obj.usage && obj.usage.completion_tokens) outTokens = obj.usage.completion_tokens;

    if (typeof delta.content === 'string' && delta.content.length) {
      if (openType !== 'text') openText();
      send('content_block_delta', { type: 'content_block_delta', index: nextIndex, delta: { type: 'text_delta', text: delta.content } });
    }
    for (const tc of (delta.tool_calls || [])) {
      const oi = tc.index != null ? tc.index : 0;
      if (!seenTool.has(oi)) { seenTool.add(oi); openTool(tc.id, tc.function && tc.function.name); }
      const frag = tc.function && tc.function.arguments;
      if (frag) send('content_block_delta', { type: 'content_block_delta', index: nextIndex, delta: { type: 'input_json_delta', partial_json: frag } });
    }
  }

  function finalize() {
    if (finished) return;
    finished = true;
    ensureStart();
    closeBlock();
    send('message_delta', { type: 'message_delta', delta: { stop_reason: STOP_MAP[finishReason] || 'end_turn', stop_sequence: null }, usage: { output_tokens: outTokens } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  }

  let buf = '';
  up.on('data', chunk => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      line = line.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '' ) continue;
      if (data === '[DONE]') { finalize(); continue; }
      let obj; try { obj = JSON.parse(data); } catch (_) { continue; }
      if (obj.error) { dbg('upstream stream error', obj.error); continue; }
      processDelta(obj);
    }
  });
  up.on('end', finalize);
  up.on('error', e => { dbg('stream upstream error', e.message); if (!res.writableEnded) finalize(); });
}

// ── /v1/messages 处理 ──────────────────────────────────────────────────────
function handleAnthropic(req, res) {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    let areq; try { areq = JSON.parse(raw); } catch (_) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } })); }
    const creq = anthropicToChat(areq);
    const body = JSON.stringify(creq);
    const estInput = Math.ceil(raw.length / 4);
    dbg('messages → chat: model=' + creq.model + ' msgs=' + creq.messages.length + ' tools=' + (creq.tools ? creq.tools.length : 0) + ' stream=' + creq.stream);

    const up = UPSTREAM_MOD.request({
      hostname: UPSTREAM_URL.hostname, port: UPSTREAM_PORT, path: UPSTREAM_CHAT, method: 'POST',
      headers: { 'authorization': 'Bearer ' + GATEWAY_API_KEY, 'host': UPSTREAM_URL.host, 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)), 'accept': creq.stream ? 'text/event-stream' : 'application/json' },
      timeout: 300000,
    }, upRes => {
      if (upRes.statusCode !== 200) {
        // 上游非 200：把错误如实回给 Claude Code（Anthropic error 形状）
        let eb = ''; upRes.on('data', d => eb += d); upRes.on('end', () => {
          dbg('upstream ' + upRes.statusCode + ': ' + eb.slice(0, 200));
          res.writeHead(upRes.statusCode, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'upstream ' + upRes.statusCode + ': ' + eb.slice(0, 500) } }));
        });
        return;
      }
      if (creq.stream) return streamChatToAnthropic(upRes, res, areq.model || GATEWAY_MODEL, estInput);
      let cb = ''; upRes.on('data', d => cb += d); upRes.on('end', () => {
        let cresp; try { cresp = JSON.parse(cb); } catch (_) { res.writeHead(502, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'bad upstream json' } })); }
        const aresp = chatToAnthropic(cresp, areq.model || GATEWAY_MODEL);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(aresp));
      });
    });
    up.on('timeout', () => { up.destroy(); if (!res.headersSent) { res.writeHead(504, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'timeout_error', message: 'upstream timeout' } })); } });
    up.on('error', e => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: e.message } })); } });
    up.write(body); up.end();
  });
}

// count_tokens：Claude Code 上下文条用，近似估算即可
function handleCountTokens(req, res) {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ input_tokens: Math.ceil(raw.length / 4) }));
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const pathOnly = req.url.split('?')[0];
  // 能力探针（本地应答，安装脚本据此判断「运行中的 proxy 是否已是含翻译的 v2」→ 免误重装/免重复问 key）
  if (pathOnly === '/v1/proxy-info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ proxy: 'chat-path-rewrite', anthropic: true, model: GATEWAY_MODEL || '(passthrough)' }));
  }
  if (req.method === 'POST' && pathOnly === '/v1/messages')            return handleAnthropic(req, res);
  if (req.method === 'POST' && pathOnly === '/v1/messages/count_tokens') return handleCountTokens(req, res);
  return handlePassthrough(req, res);
});

server.listen(PROXY_PORT, BIND_HOST, () => {
  console.error(`[proxy] listening on ${BIND_HOST}:${PROXY_PORT}`);
  console.error(`[proxy]   OpenAI  passthrough → ${GATEWAY_BASE_URL}${UPSTREAM_CHAT}`);
  console.error(`[proxy]   Anthropic /v1/messages → translate → ${GATEWAY_BASE_URL}${UPSTREAM_CHAT} (model=${GATEWAY_MODEL || 'passthrough'})`);
});
