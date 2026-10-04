'use strict';

/**
 * Slice 0.5 runner — MUX vs SPLIT under the native S1 envelope.
 *
 *   node run05.js [--backends=a,b] [--arms=MUX,SPLIT] [--tasks=L1,...] [--reps=3] [--max-turns=10] [--no-baseline]
 *
 * Separate from run.js on purpose: the earlier slices' runner stays byte-identical,
 * so their runs remain reproducible. Shared pieces are imported, not copied:
 * transport (backends.js), the S1 parser (schemas.js) and the outcome classifier
 * (classify.js). Every call is logged with its interpretation so that the
 * pre-registered measures are recomputed from disk by analyze05.js, never here.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolve, chat } = require('./backends');
const { S1, stripReasoning } = require('./schemas');
const { classify } = require('./classify');
const { ARMS, TASKS, interpret, execute } = require('./slice05');

for (const line of fs.existsSync(path.join(__dirname, '.env')) ? fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
  if (!m) continue;
  const val = m[2].replace(/^["']|["']$/g, '').trim();
  if (val === '' || (process.env[m[1]] || '').trim() !== '') continue; // never blank, never overwrite
  process.env[m[1]] = val;
}

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const set = (n) => { const v = arg(n, null); return v ? new Set(v.split(',').filter(Boolean)) : null; };
const MAX_TURNS = Number(arg('max-turns', 10));
const REPS = Number(arg('reps', 3));
const REQ_TIMEOUT_MS = 300000;
const SYSTEM =
  'You are a file-editing agent working in the current directory. ' +
  'Complete the task by using the available tools. Do not ask the user questions. ' +
  'When the task is complete, reply with DONE and no tool call.';

async function runCell({ backend, arm, task, runDir, cellId }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsb05-'));
  task.setup(dir);
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: task.prompt }];
  const trace = [];
  const calls = [];
  const flags = { anyCall: false, anyMalformed: false, anyUnknownTool: false, anyArgViolation: false, calledExpected: false, calledOtherKnown: false, calledDistractor: false, variantDialect: false, commandAbsent: false };
  let outcome = null;
  let errorDetail = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await chat(backend, { messages, tools: ARMS[arm].tools, timeoutMs: REQ_TIMEOUT_MS });
    trace.push({ turn, transport: res.transport, attempts: res.attempts, ms: res.ms, status: res.status, raw: res.raw ? res.raw.slice(0, 30000) : undefined, error: res.error });
    if (res.transport !== 'ok') { outcome = 'ERROR'; errorDetail = `${res.transport}${res.status ? ' ' + res.status : ''}${res.error ? ' ' + res.error : ''}`; break; }
    const choice = res.json && res.json.choices && res.json.choices[0];
    const message = choice && choice.message;
    if (!message) { outcome = 'ERROR'; errorDetail = 'response had no choices[0].message'; break; }
    if (choice.finish_reason === 'length') { outcome = 'ERROR'; errorDetail = 'finish_reason=length (truncated)'; break; }

    const rawText = typeof message.content === 'string' ? message.content : '';
    const parsed = S1.parse(stripReasoning(rawText).text, message);
    trace[trace.length - 1].parsed = { kind: parsed.kind, detail: parsed.detail };

    if (parsed.kind === 'none') {
      if (!flags.anyCall && !flags.anyArgViolation && !flags.commandAbsent && !flags.anyUnknownTool) { outcome = 'F0'; errorDetail = 'no tool call in the first reply'; }
      break;
    }
    if (parsed.kind === 'malformed') {
      flags.anyMalformed = true;
      calls.push({ turn, malformed: parsed.detail });
      messages.push({ role: 'assistant', content: rawText || '' });
      messages.push({ role: 'user', content: `Your tool call could not be read (${parsed.detail}). Emit it again.` });
      continue;
    }

    messages.push({ role: 'assistant', content: rawText || null, tool_calls: message.tool_calls });
    for (const c of parsed.calls) {
      const it = interpret(arm, c.name, c.args);
      let result;
      if (it.unknownTool) { flags.anyUnknownTool = true; result = it.error; }
      else if (it.commandAbsent) { flags.commandAbsent = true; flags.anyArgViolation = true; result = it.error; }
      else if (it.missing.length) { flags.anyArgViolation = true; result = it.error; }
      else { flags.anyCall = true; flags.calledExpected = true; result = execute(dir, it.op, c.args); }
      calls.push({ turn, id: c.id, name: c.name, args: c.args, op: it.op, missing: it.missing, irrelevant: it.irrelevant, commandAbsent: !!it.commandAbsent, unknownTool: !!it.unknownTool, result: String(result).slice(0, 300) });
      messages.push({ role: 'tool', tool_call_id: c.id, content: String(result) });
    }
  }

  let verify = null;
  let outcomeTolerant;
  if (outcome === null || outcome === 'F0') {
    verify = task.verify(dir);
    if (outcome === null) outcome = classify({ flags, verify, transportOutcome: null, strict: true }).outcome;
  }
  outcomeTolerant = outcome; // no dialects under S1: strict and tolerant coincide
  const rec = { cellId, backend: backend.id, model: backend.model, arm, task: task.id, outcome, outcomeTolerant, errorDetail, verify, flags, calls, turns: trace.length, trace };
  fs.writeFileSync(path.join(runDir, `${cellId}.json`), JSON.stringify(rec, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  return rec;
}

async function runBaseline({ backend, task, runDir, cellId }) {
  const res = await chat(backend, { messages: [{ role: 'system', content: 'Answer with the requested content only. No explanation.' }, { role: 'user', content: task.baselineQuestion }], timeoutMs: REQ_TIMEOUT_MS });
  let outcome, detail = null, answer = '';
  if (res.transport !== 'ok') { outcome = 'ERROR'; detail = `${res.transport}${res.status ? ' ' + res.status : ''}`; }
  else {
    const ch = res.json.choices && res.json.choices[0];
    if (!ch || !ch.message) { outcome = 'ERROR'; detail = 'no message'; }
    else if (ch.finish_reason === 'length') { outcome = 'ERROR'; detail = 'truncated'; }
    else { answer = stripReasoning(typeof ch.message.content === 'string' ? ch.message.content : '').text; const v = task.baselineVerify(answer); outcome = v.ok ? 'OK' : 'F3'; detail = v.detail || null; }
  }
  const rec = { cellId, backend: backend.id, model: backend.model, arm: 'S0', task: task.id, isBaseline: true, outcome, errorDetail: detail, answer: answer.slice(0, 2000), raw: res.raw ? res.raw.slice(0, 20000) : undefined };
  fs.writeFileSync(path.join(runDir, `${cellId}.json`), JSON.stringify(rec, null, 2));
  return rec;
}

async function main() {
  const onlyB = set('backends'), onlyA = set('arms'), onlyT = set('tasks');
  const backends = resolve();
  console.log('\n=== backend availability ===');
  for (const b of backends) console.log(`  ${b.available ? 'AVAILABLE  ' : 'UNAVAILABLE'} ${b.id.padEnd(12)} ${b.available ? b.model : b.unavailableReason}`);
  let live = backends.filter((b) => b.available && (!onlyB || onlyB.has(b.id)));
  const arms = Object.keys(ARMS).filter((a) => !onlyA || onlyA.has(a));
  const tasks = TASKS.filter((t) => !onlyT || onlyT.has(t.id));
  for (const [label, req, got] of [['backend', onlyB, live.map((b) => b.id)], ['arm', onlyA, arms], ['task', onlyT, tasks.map((t) => t.id)]]) {
    if (!req) continue;
    const missing = [...req].filter((x) => !got.includes(x));
    if (missing.length) { console.error(`unknown or unavailable ${label}(s): ${missing.join(', ')}`); process.exit(2); }
  }
  if (!live.length || !Number.isInteger(REPS) || REPS < 1) { console.error('nothing to run'); process.exit(2); }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(__dirname, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  const per = await Promise.all(live.map(async (b) => {
    const out = [];
    if (!process.argv.includes('--no-baseline')) {
      for (const t of tasks.filter((x) => x.baselineQuestion)) {
        const r = await runBaseline({ backend: b, task: t, runDir, cellId: `base_${b.id}_${t.id}` });
        out.push(r);
        console.log(`  [base] ${b.id.padEnd(11)} S0    ${t.id} -> ${r.outcome}${r.errorDetail ? '  (' + String(r.errorDetail).slice(0, 50) + ')' : ''}`);
      }
    }
    for (let rep = 1; rep <= REPS; rep++) {
      for (const t of tasks) {
        for (const a of arms) {
          const r = await runCell({ backend: b, arm: a, task: t, runDir, cellId: `s05_${b.id}_${a}_${t.id}_r${rep}` });
          out.push(r);
          const om = r.calls.filter((c) => c.missing && c.missing.length).length;
          console.log(`  [cell] ${b.id.padEnd(11)} ${a.padEnd(5)} ${t.id} r${rep} -> ${r.outcome}${om ? `  omissions=${om}` : ''}${r.errorDetail ? '  (' + String(r.errorDetail).slice(0, 50) + ')' : ''}`);
        }
      }
    }
    return out;
  }));
  const records = per.flat();
  fs.writeFileSync(path.join(runDir, 'records.json'), JSON.stringify({ runId, slice: '0.5', maxTurns: MAX_TURNS, reps: REPS, argv: process.argv.slice(2), backends: backends.map(({ apiKey, ...b }) => b), records }, null, 2));
  console.log(`\nraw cells persisted to: ${runDir}\nnext: node analyze05.js ${path.relative(__dirname, runDir)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
