#!/usr/bin/env node
'use strict';
// 确定性 mock 验证：Anthropic /v1/messages → proxy → (mock chat 上游) 回译
// 判据全为「结构断言」，不看形容词：mock 收到的必须是 Chat 格式含 tools/tool_calls/role:tool；
// proxy 回给客户端的必须是良构 Anthropic（非流 tool_use 块 / 流式 SSE 事件序列）。
const http = require('http');

const UP_PORT = 19099, PROXY_PORT = 19423;
let captured = [];   // mock 收到的每个 chat 请求体

// ── mock 上游（/v1/model/chat/completions）──
const upstream = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c); req.on('end', () => {
    const j = JSON.parse(b || '{}');
    captured.push({ path: req.url, body: j });
    if (j.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const w = o => res.write('data: ' + JSON.stringify(o) + '\n\n');
      w({ choices: [{ delta: { role: 'assistant' } }] });
      w({ choices: [{ delta: { content: 'Let me check.' } }] });
      w({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '' } }] } }] });
      w({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":' } }] } }] });
      w({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"SF"}' } }] } }] });
      w({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { completion_tokens: 12 } });
      res.write('data: [DONE]\n\n'); res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-x', choices: [{ message: { role: 'assistant', content: 'Sunny.', tool_calls: [{ id: 'call_9', type: 'function', function: { name: 'get_weather', arguments: '{"city":"SF"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 50, completion_tokens: 8 },
      }));
    }
  });
});

function req(path, bodyObj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(bodyObj);
    const r = http.request({ host: '127.0.0.1', port: PROXY_PORT, path, method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': 'sk-client', 'content-length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: d }));
    });
    r.on('error', reject); r.write(body); r.end();
  });
}

const ANTHRO_REQ_BASE = {
  model: 'claude-sonnet-4-5', max_tokens: 100, system: 'You are helpful.',
  tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } }],
  messages: [
    { role: 'user', content: 'weather in SF?' },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'call_prev', name: 'get_weather', input: { city: 'SF' } }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_prev', content: 'was 20C yesterday' }] },
  ],
};

let pass = 0, fail = 0;
const check = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + extra : '')); } };

async function main() {
  await new Promise(r => upstream.listen(UP_PORT, '127.0.0.1', r));
  process.env.GATEWAY_BASE_URL = 'http://127.0.0.1:' + UP_PORT;
  process.env.GATEWAY_PATH_PREFIX = '/v1/model';
  process.env.GATEWAY_MODEL = 'test-model';
  process.env.GATEWAY_API_KEY = 'sk-upstream';
  process.env.PROXY_PORT = String(PROXY_PORT);
  process.env.BIND_HOST = '127.0.0.1';
  require('./proxy.js');
  await new Promise(r => setTimeout(r, 400));

  // ── 1. 非流式 ──
  console.log('\n[非流式 /v1/messages]');
  captured = [];
  const r1 = await req('/v1/messages', { ...ANTHRO_REQ_BASE, stream: false });
  const up1 = captured[0] && captured[0].body;
  check('proxy 返回 200', r1.status === 200, 'status=' + r1.status);
  check('上游收到 Chat 请求', !!up1);
  check('上游路径重写为 /v1/model/chat/completions', captured[0] && captured[0].path === '/v1/model/chat/completions', captured[0] && captured[0].path);
  check('model 被强制重写为 test-model', up1 && up1.model === 'test-model', up1 && up1.model);
  check('tools 翻译成 OpenAI function 形状', up1 && Array.isArray(up1.tools) && up1.tools[0] && up1.tools[0].type === 'function' && up1.tools[0].function.name === 'get_weather');
  check('tools.parameters = input_schema（未丢）', up1 && up1.tools[0].function.parameters && up1.tools[0].function.parameters.properties && up1.tools[0].function.parameters.properties.city);
  check('system 变成首条 system 消息', up1 && up1.messages[0].role === 'system' && /helpful/.test(up1.messages[0].content));
  const asstMsg = up1 && up1.messages.find(m => m.role === 'assistant' && m.tool_calls);
  check('历史 tool_use → assistant.tool_calls', !!asstMsg && asstMsg.tool_calls[0].function.name === 'get_weather');
  check('assistant.tool_calls.arguments 是 JSON 字符串', asstMsg && typeof asstMsg.tool_calls[0].function.arguments === 'string' && JSON.parse(asstMsg.tool_calls[0].function.arguments).city === 'SF');
  const toolMsg = up1 && up1.messages.find(m => m.role === 'tool');
  check('tool_result → role:tool 消息', !!toolMsg && toolMsg.tool_call_id === 'call_prev' && /20C/.test(toolMsg.content));
  // 回译
  let a1; try { a1 = JSON.parse(r1.text); } catch (_) { a1 = {}; }
  check('回译 type=message', a1.type === 'message');
  check('回译含 text 块', Array.isArray(a1.content) && a1.content.some(b => b.type === 'text' && /Sunny/.test(b.text)));
  const tu = Array.isArray(a1.content) && a1.content.find(b => b.type === 'tool_use');
  check('回译含 tool_use 块（input 已 parse 成对象）', !!tu && tu.name === 'get_weather' && tu.input.city === 'SF');
  check('stop_reason=tool_use', a1.stop_reason === 'tool_use', a1.stop_reason);
  check('usage 映射 input/output_tokens', a1.usage && a1.usage.input_tokens === 50 && a1.usage.output_tokens === 8);

  // ── 2. 流式 ──
  console.log('\n[流式 /v1/messages stream=true]');
  captured = [];
  const events = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ ...ANTHRO_REQ_BASE, stream: true });
    const r = http.request({ host: '127.0.0.1', port: PROXY_PORT, path: '/v1/messages', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => {
        const evs = [];
        d.split('\n\n').forEach(chunk => {
          const el = chunk.split('\n').find(l => l.startsWith('event:'));
          const dl = chunk.split('\n').find(l => l.startsWith('data:'));
          if (el && dl) { try { evs.push({ event: el.slice(6).trim(), data: JSON.parse(dl.slice(5).trim()) }); } catch (_) {} }
        });
        resolve({ raw: d, evs, ct: res.headers['content-type'] });
      });
    });
    r.on('error', reject); r.write(body); r.end();
  });
  const names = events.evs.map(e => e.event);
  check('content-type 是 text/event-stream', /event-stream/.test(events.ct || ''), events.ct);
  check('首事件 message_start', names[0] === 'message_start');
  check('末事件 message_stop', names[names.length - 1] === 'message_stop');
  check('有 text content_block_start', events.evs.some(e => e.event === 'content_block_start' && e.data.content_block.type === 'text'));
  check('有 text_delta("Let me check.")', events.evs.some(e => e.event === 'content_block_delta' && e.data.delta.type === 'text_delta' && /check/.test(e.data.delta.text)));
  check('有 tool_use content_block_start(name=get_weather)', events.evs.some(e => e.event === 'content_block_start' && e.data.content_block.type === 'tool_use' && e.data.content_block.name === 'get_weather'));
  const jsonDeltas = events.evs.filter(e => e.event === 'content_block_delta' && e.data.delta.type === 'input_json_delta').map(e => e.data.delta.partial_json).join('');
  check('input_json_delta 拼起来是合法参数', jsonDeltas.replace(/\s/g, '') === '{"city":"SF"}', jsonDeltas);
  check('content_block_stop 出现', names.includes('content_block_stop'));
  const md = events.evs.find(e => e.event === 'message_delta');
  check('message_delta.stop_reason=tool_use', md && md.data.delta.stop_reason === 'tool_use', md && md.data.delta.stop_reason);
  check('message_delta.usage.output_tokens=12', md && md.data.usage && md.data.usage.output_tokens === 12);
  // 上游流式请求体也必须带 tools（防「流式路径漏 tools」的老 bug）
  check('流式上游请求体含 tools', captured[0] && Array.isArray(captured[0].body.tools) && captured[0].body.tools.length === 1);
  check('流式上游 stream=true', captured[0] && captured[0].body.stream === true);

  // ── 3. count_tokens ──
  console.log('\n[/v1/messages/count_tokens]');
  const r3 = await req('/v1/messages/count_tokens', ANTHRO_REQ_BASE);
  let c3; try { c3 = JSON.parse(r3.text); } catch (_) { c3 = {}; }
  check('返回 input_tokens 数值', typeof c3.input_tokens === 'number' && c3.input_tokens > 0);

  console.log('\n========================================');
  console.log(`  PASS ${pass}  /  FAIL ${fail}`);
  console.log('========================================');
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });
