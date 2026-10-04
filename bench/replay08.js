'use strict';

/**
 * Slice 0.8 — prefix replay. Pre-registered in BENCH-DESIGN.md (commit cf457c7),
 * approved by the maintainer, who accepted that benchmark task content from Right
 * Fit's released trajectories is sent to Moonshot's API.
 *
 *   RF_DATA=<local copy of the HF dataset> node replay08.js [--dry-run] [--limit=N]
 *
 * Raw requests and replies go to runs-private/<runId>/ (git-ignored): they contain
 * benchmark content (CC BY-NC, do-not-train canary). runs/<runId>/summary.json gets
 * identifiers, classifications and token counts only.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { resolve, chat } = require('./backends');
require('./run05'); // loads .env without overwriting
const S06 = require('./slice06');
const { rng } = require('./slice07');

const DATA = process.env.RF_DATA || path.join(__dirname, '..', 'analysis', 'right-fit', 'data');
const MAX_PREFIX_CHARS = 120000;
const SEED = 8008;
const PLAN = { omit: { 'terminal-bench-4': 10, 'tua-bench': 10 }, ok: { 'terminal-bench-4': 3, 'tua-bench': 3 } };

const isCreate = (t) => {
  if (!t || t.name !== 'file_editor') return null;
  try { const a = JSON.parse(t.arguments || '{}'); return a.command === 'create' ? a : null; } catch { return null; }
};
const chars = (msgs) => msgs.reduce((n, m) => n + (m.content ? String(m.content).length : 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0), 0);

/** One prefix per run: everything before the assistant message with the first create. */
function prefixOf(run) {
  const M = run.messages || [];
  for (let i = 0; i < M.length; i++) {
    if (M[i].role !== 'assistant') continue;
    const c = (M[i].tool_calls || []).map(isCreate).find(Boolean);
    if (c) return { prefix: M.slice(0, i), original: 'file_text' in c ? 'ok' : 'omit', at: i };
  }
  return null;
}

/** Dataset message -> Chat Completions message. Logging-only fields are dropped. */
function toApi(m, { emptyReasoning = false } = {}) {
  if (m.role === 'assistant') {
    const out = { role: 'assistant', content: m.content == null ? '' : m.content };
    if (m.tool_calls && m.tool_calls.length) out.tool_calls = m.tool_calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments || '{}' } }));
    if (emptyReasoning) out.reasoning_content = '';
    return out;
  }
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content == null ? '' : String(m.content) };
  return { role: m.role, content: m.content == null ? '' : m.content };
}

/** Classify a reply message, as pre-registered. */
function classifyReply(message) {
  const calls = (message && message.tool_calls) || [];
  if (!calls.length) return { cls: 'text', summary: null };
  const flat = calls.map((c) => ({ name: c.function && c.function.name, arguments: c.function && c.function.arguments }));
  const create = flat.map((t) => ({ t, a: isCreate(t) })).find((x) => x.a);
  if (create) return { cls: 'file_text' in create.a ? 'create-ok' : 'create-omit', summary: 'summary' in create.a };
  let a = {};
  try { a = JSON.parse(flat[0].arguments || '{}'); } catch { /* unreadable args are still "another tool call" */ }
  return { cls: 'other-tool', tool: flat[0].name, summary: 'summary' in a };
}

function loadPool() {
  const pool = [];
  let excludedSize = 0;
  for (const b of ['terminal-bench-4', 'tua-bench']) {
    const f = path.join(DATA, 'trajectories', b, 'openhands', 'kimi-k3.jsonl.gz');
    for (const line of zlib.gunzipSync(fs.readFileSync(f)).toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      const run = JSON.parse(line);
      const p = prefixOf(run);
      if (!p) continue;
      if (chars(p.prefix) > MAX_PREFIX_CHARS) { excludedSize++; continue; }
      pool.push({ bench: b, task: run.task_id, original: p.original, prefix: p.prefix, prefixChars: chars(p.prefix), at: p.at });
    }
  }
  return { pool, excludedSize };
}

function sample(pool) {
  const r = rng(SEED);
  const out = [];
  for (const [orig, per] of Object.entries(PLAN)) {
    for (const [b, k] of Object.entries(per)) {
      const xs = pool.filter((x) => x.original === orig && x.bench === b).sort((x, y) => (x.task < y.task ? -1 : 1));
      for (let i = xs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [xs[i], xs[j]] = [xs[j], xs[i]]; }
      out.push(...xs.slice(0, k));
    }
  }
  return out;
}

async function main() {
  const dry = process.argv.includes('--dry-run');
  const lim = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1] || Infinity);
  const { pool, excludedSize } = loadPool();
  const picks = sample(pool).slice(0, lim);
  const counts = pool.reduce((m, x) => ((m[`${x.bench}/${x.original}`] = (m[`${x.bench}/${x.original}`] || 0) + 1), m), {});
  console.log(`pool after size cap: ${JSON.stringify(counts)}; excluded by size: ${excludedSize}; sampled ${picks.length}`);
  if (dry) { picks.forEach((p) => console.log(`  ${p.bench} ${p.task} original=${p.original} prefixChars=${p.prefixChars}`)); return; }

  const k3 = resolve().find((b) => b.id === 'kimi-k3' && b.available);
  if (!k3) { console.error('kimi-k3 unavailable'); process.exit(2); }
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const pub = path.join(__dirname, 'runs', runId), priv = path.join(__dirname, 'runs-private', runId);
  fs.mkdirSync(pub, { recursive: true });
  fs.mkdirSync(priv, { recursive: true });
  const tools = JSON.parse(JSON.stringify(S06.OH_TOOLS));
  const rows = [];
  for (const p of picks) {
    let emptyReasoning = false;
    let res = await chat(k3, { messages: p.prefix.map((m) => toApi(m)), tools, timeoutMs: 600000 });
    if (res.transport === 'http_error' && res.status === 400) {
      emptyReasoning = true; // pre-registered fallback, reported per row
      res = await chat(k3, { messages: p.prefix.map((m) => toApi(m, { emptyReasoning: true })), tools, timeoutMs: 600000 });
    }
    const msg = res.transport === 'ok' && res.json.choices && res.json.choices[0] && res.json.choices[0].message;
    const finish = res.transport === 'ok' && res.json.choices[0].finish_reason;
    const c = !msg ? { cls: 'ERROR', detail: `${res.transport} ${res.status || ''} ${(res.raw || res.error || '').slice(0, 160)}` } : finish === 'length' ? { cls: 'ERROR', detail: 'finish_reason=length' } : classifyReply(msg);
    const usage = res.json && res.json.usage;
    rows.push({ bench: p.bench, task: p.task, original: p.original, prefixChars: p.prefixChars, emptyReasoning, ...c, usage });
    fs.writeFileSync(path.join(priv, `${p.bench}__${p.task}.json`), JSON.stringify({ request: { messages: p.prefix.map((m) => toApi(m, { emptyReasoning })) }, response: res.raw ? res.raw.slice(0, 200000) : res.error }, null, 1));
    console.log(`  ${p.bench.padEnd(17)} ${p.task.slice(0, 40).padEnd(40)} original=${p.original.padEnd(4)} -> ${c.cls}${c.tool ? ' (' + c.tool + ')' : ''}${emptyReasoning ? ' [empty-reasoning fallback]' : ''}${c.detail ? ' ' + c.detail : ''}`);
  }
  fs.writeFileSync(path.join(pub, 'summary.json'), JSON.stringify({ runId, slice: '0.8', seed: SEED, maxPrefixChars: MAX_PREFIX_CHARS, poolCounts: counts, excludedSize, rows }, null, 2));
  console.log(`\nsummary: ${path.join(pub, 'summary.json')}  (raw: runs-private/, git-ignored)\nnext: node analyze08.js runs/${runId}`);
}

module.exports = { prefixOf, toApi, classifyReply, sample, chars, PLAN };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
