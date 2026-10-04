'use strict';

/**
 * Slice 0.6 runner.
 *   node run06.js --backends=kimi-k3 --arms=OH,BASE [--tasks=L1,...] [--reps=6] [--max-turns=10]
 * Stage 2 arms (A-meta, A-desc, A-sys, A-solo) run only after Stage 1 reproduces
 * (BENCH-DESIGN.md, Slice 0.6 decision rule). Measures are computed by analyze06.js.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve, chat } = require('./backends');
const { S1, stripReasoning } = require('./schemas');
const { assistantTurn, SYSTEM: BASE_SYSTEM } = require('./run05'); // also loads .env
const S05 = require('./slice05');
const S06 = require('./slice06');

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const set = (n) => { const v = arg(n, null); return v ? new Set(v.split(',').filter(Boolean)) : null; };
const MAX_TURNS = Number(arg('max-turns', 10));
const REPS = Number(arg('reps', 6));

function interpretCall(family, name, args) {
  if (family === 'OH') return S06.interpretOH(name, args);
  const it = S05.interpret('MUX', name, args);
  return { tool: name, op: it.op, missing: it.missing, meta: S06.META.filter((k) => args && k in args), commandAbsent: !!it.commandAbsent, unknownTool: !!it.unknownTool, error: it.error };
}

function executeCall(family, dir, name, args, it) {
  if (family === 'OH') return S06.execOH(dir, name, args);
  const rel = S06.mapPath(args.path);
  if (rel === null) return `Error: path must be inside ${S06.WORKSPACE}.`;
  return S05.execute(dir, it.op, { ...args, path: rel });
}

async function runCell({ backend, arm, task, runDir, cellId }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb06-'));
  task.setup(dir);
  const sf = S06.surface(arm, BASE_SYSTEM);
  const messages = [{ role: 'system', content: sf.system }, { role: 'user', content: task.prompt }];
  const trace = [], calls = [];
  let outcome = null, errorDetail = null, finished = false;

  for (let turn = 0; turn < MAX_TURNS && !finished; turn++) {
    const res = await chat(backend, { messages, tools: sf.tools, timeoutMs: 300000 });
    trace.push({ turn, transport: res.transport, attempts: res.attempts, ms: res.ms, status: res.status, raw: res.raw ? res.raw.slice(0, 40000) : undefined, error: res.error });
    if (res.transport !== 'ok') { outcome = 'ERROR'; errorDetail = `${res.transport}${res.status ? ' ' + res.status : ''}${res.error ? ' ' + res.error : ''}`; break; }
    const ch = res.json && res.json.choices && res.json.choices[0];
    if (!ch || !ch.message) { outcome = 'ERROR'; errorDetail = 'no choices[0].message'; break; }
    if (ch.finish_reason === 'length') { outcome = 'ERROR'; errorDetail = 'finish_reason=length'; break; }
    const rawText = typeof ch.message.content === 'string' ? ch.message.content : '';
    const parsed = S1.parse(stripReasoning(rawText).text, ch.message);
    if (parsed.kind === 'none') break;
    if (parsed.kind === 'malformed') {
      calls.push({ turn, malformed: parsed.detail });
      messages.push({ role: 'assistant', content: rawText || '' });
      messages.push({ role: 'user', content: `Your tool call could not be read (${parsed.detail}).` });
      continue;
    }
    messages.push(assistantTurn(backend, ch.message, rawText));
    for (const c of parsed.calls) {
      const it = interpretCall(sf.family, c.name, c.args);
      let result;
      if (it.error) result = it.error;
      else if (it.unknownTool) result = `No such tool: ${c.name}`;
      else result = executeCall(sf.family, dir, c.name, c.args, it);
      if (c.name === 'finish') finished = true;
      calls.push({ turn, id: c.id, name: c.name, args: c.args, op: it.op, missing: it.missing || [], meta: it.meta || [], commandAbsent: !!it.commandAbsent, result: String(result).slice(0, 300) });
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(result) });
    }
  }
  const verify = outcome === 'ERROR' ? null : task.verify(dir);
  if (outcome === null) outcome = verify.ok ? 'OK' : 'FAIL';
  const rec = { cellId, backend: backend.id, model: backend.model, arm, family: sf.family, task: task.id, outcome, errorDetail, verify, calls, turns: trace.length, trace };
  fs.writeFileSync(path.join(runDir, `${cellId}.json`), JSON.stringify(rec, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  return rec;
}

async function main() {
  const onlyB = set('backends'), onlyA = set('arms'), onlyT = set('tasks');
  if (!onlyA) { console.error('--arms is required (Stage 1: OH,BASE)'); process.exit(2); }
  const live = resolve().filter((b) => b.available && (!onlyB || onlyB.has(b.id)));
  const arms = [...onlyA];
  const tasks = S06.TASKS.filter((t) => !onlyT || onlyT.has(t.id));
  const bad = arms.filter((a) => !S06.ARMS.includes(a));
  if (bad.length || !live.length || !tasks.length || (onlyT && tasks.length !== onlyT.size)) { console.error(`bad arguments: arms=${bad} backends=${live.length} tasks=${tasks.length}`); process.exit(2); }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(__dirname, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });
  for (const b of live) {
    for (let rep = 1; rep <= REPS; rep++) for (const t of tasks) for (const a of arms) {
      const r = await runCell({ backend: b, arm: a, task: t, runDir, cellId: `s06_${b.id}_${a}_${t.id}_r${rep}` });
      const fc = r.calls.find((c) => c.name === 'file_editor' && c.op === 'create');
      console.log(`  [cell] ${b.id} ${a.padEnd(6)} ${t.id} r${rep} -> ${r.outcome}  first-create=${fc ? (fc.missing.includes('file_text') ? 'OMIT' : 'ok') : 'none'}${r.errorDetail ? '  (' + r.errorDetail.slice(0, 50) + ')' : ''}`);
    }
  }
  fs.writeFileSync(path.join(runDir, 'records.json'), JSON.stringify({ runId, slice: '0.6', maxTurns: MAX_TURNS, reps: REPS, argv: process.argv.slice(2) }, null, 2));
  console.log(`\nraw cells persisted to: ${runDir}\nnext: node analyze06.js ${path.relative(__dirname, runDir)}`);
}

module.exports = { interpretCall, executeCall };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
