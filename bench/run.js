'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolve, chat } = require('./backends');
const { S0, FORMS, stripReasoning } = require('./schemas');
const { TOOLS, TASKS, CONTROLS, execute, validateArgs } = require('./tasks');
const { classify } = require('./classify');

/**
 * Zero-dependency .env loader.
 *
 * Two rules, both learned the hard way while wiring this bench up:
 *   - never overwrite a variable that is already set to a non-empty value
 *   - never set a variable to an empty string
 * A file declaring `FOO=` silently blanking an exported `FOO` produces a 401
 * that is indistinguishable from a revoked credential. That is exactly the
 * "missing disguised as data" failure this project studies, occurring in the
 * project's own plumbing.
 */
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2].replace(/^["']|["']$/g, '').trim();
    if (val === '') continue;
    const existing = process.env[key];
    if (existing !== undefined && existing.trim() !== '') continue;
    process.env[key] = val;
  }
}
loadEnv(path.join(__dirname, '.env'));

// Turn budget. This is a PARAMETER, not a property of any envelope, and it is
// overridable precisely so that a failure attributed to per-turn overhead can be
// tested against it: if raising the cap turns the failures into successes, the
// finding is about margin, not capability. Reported in every run record.
const MAX_TURNS = Number(process.argv.find((a) => a.startsWith('--max-turns='))?.split('=')[1] || 6);
// Measured: one Kimi reply took 63s. 120s produced timeouts that would have been
// misread as backend failures, so the ceiling is set well clear of observed latency.
const REQ_TIMEOUT_MS = 300000;
const SYSTEM_BASE =
  'You are a file-editing agent working in the current directory. ' +
  'Complete the task by using the available tools. Do not ask the user questions.';

/* -------------------------------------------------------------------------- */
/* outcome codes — see BENCH-DESIGN.md rule 3                                  */
/*   OK    executed, correct side effect                                       */
/*   F0    no tool call emitted (affirmative)                                  */
/*   F1    tool call emitted, wrong tool                                       */
/*   F2    right envelope, arguments violate the declared schema               */
/*   F3    right tool, valid arguments, wrong values                           */
/*   F4    executed, side effect absent or wrong                               */
/*   ERROR transport/parse failure — NOT evidence about the model              */
/* -------------------------------------------------------------------------- */

function sandbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tsbench-'));
}

async function runCell({ backend, form, task, toolNames, runDir, cellId }) {
  const dir = sandbox();
  const tools = TOOLS.filter((t) => toolNames.includes(t.name));
  task.setup(dir);

  const { toolsField, systemSuffix } = form.buildRequest(tools);
  const messages = [
    { role: 'system', content: SYSTEM_BASE + systemSuffix },
    { role: 'user', content: task.prompt },
  ];

  const trace = [];
  const flags = {
    anyCall: false,
    anyMalformed: false,
    anyUnknownTool: false,
    anyArgViolation: false,
    calledExpected: false,
    calledOtherKnown: false,
    reasoningStripped: false,
    truncatedReasoning: false,
    variantDialect: false, // a strict scaffold would have rejected at least one call
    coercions: [],         // non-string args that arrived JSON-encoded as text
    escapingUsed: false,   // entity escaping applied inside a prompt-embedded value
    paramSyntaxFailure: false, // <parameter> tags present but unreadable (NOT an omission)
    calledDistractor: false,
  };
  let outcome = null;
  let errorDetail = null;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await chat(backend, { messages, tools: toolsField || undefined, timeoutMs: REQ_TIMEOUT_MS });
    trace.push({ turn, transport: res.transport, attempts: res.attempts, ms: res.ms, status: res.status, raw: res.raw ? res.raw.slice(0, 20000) : undefined, error: res.error });

    if (res.transport !== 'ok') {
      outcome = 'ERROR';
      errorDetail = `${res.transport}${res.status ? ' ' + res.status : ''}${res.error ? ' ' + res.error : ''}`;
      break;
    }

    const message = res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].message;
    if (!message) {
      outcome = 'ERROR';
      errorDetail = 'response had no choices[0].message';
      break;
    }
    const finish = res.json.choices[0].finish_reason;
    const rawText = typeof message.content === 'string' ? message.content : '';
    const { text, stripped, unclosed } = stripReasoning(rawText);
    if (stripped) flags.reasoningStripped = true;
    if (unclosed) flags.truncatedReasoning = true;

    // Truncation is not absence. If the reply ran out of tokens we cannot tell
    // whether a tool call was coming, so this is ERROR, never F0.
    if (finish === 'length') {
      outcome = 'ERROR';
      errorDetail = 'finish_reason=length (truncated; cannot distinguish absence from cutoff)';
      break;
    }

    const parsed = form.parse(text, message);
    trace[trace.length - 1].parsed = { kind: parsed.kind, name: parsed.name, detail: parsed.detail, dialect: parsed.dialect, args: parsed.args };
    if (parsed.dialect === 'variant') flags.variantDialect = true;
    if (parsed.escapingUsed) flags.escapingUsed = true;
    if (parsed.paramSyntaxFailure) flags.paramSyntaxFailure = true;

    if (parsed.kind === 'none') {
      if (!flags.anyCall) {
        outcome = 'F0';
        errorDetail = 'no tool-call structure present in the first reply';
      }
      break; // either F0, or a normal end-of-work reply after real calls
    }

    if (parsed.kind === 'malformed') {
      flags.anyMalformed = true;
      messages.push({ role: 'assistant', content: rawText });
      messages.push({ role: 'user', content: `Your tool call could not be read (${parsed.detail}). Emit it again in the exact required format.` });
      continue;
    }

    // parsed.kind === 'call'
    //
    // PARALLEL CALLS. The native form lets a model emit several tool calls in
    // one message, and the API requires a tool message answering EVERY
    // tool_call_id. An earlier version executed only the first and echoed the
    // whole array, which the provider rejected with a 400 — on exactly the
    // chain-depth task where the native form's parallelism shows up. That would
    // have deleted S1's chain cells as ERROR and produced an availability skew
    // correlated with the independent variable: the same failure family this
    // bench is built to detect, inside the bench.
    //
    // Prompt-embedded forms specify one call at a time and cannot express
    // parallelism, so `calls` is length 1 for them. That asymmetry is a real
    // property of the envelopes, and it is recorded rather than equalised away.
    const calls = parsed.calls && parsed.calls.length ? parsed.calls : [parsed];
    if (calls.length > 1) flags.parallelCalls = Math.max(flags.parallelCalls || 0, calls.length);
    flags.anyCall = true;

    if (form.id === 'S1') messages.push({ role: 'assistant', content: rawText || null, tool_calls: message.tool_calls });
    else messages.push({ role: 'assistant', content: rawText });

    const validations = [];
    for (const call of calls) {
      const v = validateArgs(call.name, call.args);
      validations.push(v.ok ? 'ok' : v.detail);

      if (v.unknownTool) {
        flags.anyUnknownTool = true;
        messages.push(form.renderResult(call, { error: v.detail }));
        continue;
      }
      if (!v.ok) {
        flags.anyArgViolation = true;
        messages.push(form.renderResult(call, { error: v.detail }));
        continue;
      }

      if (call.name === task.expectedTool) flags.calledExpected = true;
      else flags.calledOtherKnown = true;
      if (v.coercions && v.coercions.length) flags.coercions.push(...v.coercions);
      if (v.isDistractor) flags.calledDistractor = true;

      messages.push(form.renderResult(call, execute(dir, call.name, v.coerced)));
    }
    trace[trace.length - 1].validation = validations.length === 1 ? validations[0] : validations;
  }

  // ---- verdict ------------------------------------------------------------
  let verify = null;
  let recovered;
  let outcomeTolerant;
  if (outcome === null || outcome === 'F0') {
    verify = task.verify(dir);
    if (outcome === null) {
      const tolerant = classify({ flags, verify, transportOutcome: null });
      const strict = classify({ flags, verify, transportOutcome: null, strict: true });
      outcome = strict.outcome;              // Slice 0.2: strict is the primary DV
      outcomeTolerant = tolerant.outcome;
      recovered = strict.recovered || tolerant.recovered;
      if (outcome === 'F0') errorDetail = 'loop ended with no tool call';
    }
  }

  if (outcomeTolerant === undefined) outcomeTolerant = outcome;
  const record = { cellId, backend: backend.id, model: backend.model, form: form.id, task: task.id, toolCount: toolNames.length, outcome, outcomeTolerant, recovered, errorDetail, verify, flags, turns: trace.length, trace };
  fs.writeFileSync(path.join(runDir, `${cellId}.json`), JSON.stringify(record, null, 2));
  fs.rmSync(dir, { recursive: true, force: true });
  return record;
}

async function runBaseline({ backend, task, runDir, cellId }) {
  const messages = [
    { role: 'system', content: 'Answer with the requested content only. No explanation, no formatting.' },
    { role: 'user', content: task.baselineQuestion },
  ];
  const res = await chat(backend, { messages, timeoutMs: REQ_TIMEOUT_MS });
  let outcome, detail = null, answer = '';
  if (res.transport !== 'ok') {
    outcome = 'ERROR';
    detail = `${res.transport}${res.status ? ' ' + res.status : ''}`;
  } else {
    const message = res.json && res.json.choices && res.json.choices[0] && res.json.choices[0].message;
    const finish = res.json.choices[0] && res.json.choices[0].finish_reason;
    if (!message) { outcome = 'ERROR'; detail = 'no message'; }
    else if (finish === 'length') { outcome = 'ERROR'; detail = 'truncated'; }
    else {
      answer = stripReasoning(typeof message.content === 'string' ? message.content : '').text;
      const v = task.baselineVerify(answer);
      outcome = v.ok ? 'OK' : 'F3';
      detail = v.detail || null;
    }
  }
  // The baseline has no envelope, so strict and tolerant scoring cannot differ.
  const record = { cellId, backend: backend.id, model: backend.model, form: 'S0', task: task.id, outcome, outcomeTolerant: outcome, errorDetail: detail, answer: answer.slice(0, 400), raw: res.raw ? res.raw.slice(0, 20000) : undefined };
  fs.writeFileSync(path.join(runDir, `${cellId}.json`), JSON.stringify(record, null, 2));
  return record;
}

/* -------------------------------------------------------------------------- */

function argSet(name) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? new Set(a.split('=')[1].split(',').filter(Boolean)) : null;
}

async function main() {
  const onlyBackends = argSet('backends');
  const onlyForms = argSet('forms');
  const onlyTasks = argSet('tasks');
  const skipBaseline = process.argv.includes('--no-baseline');
  const skipControls = process.argv.includes('--no-controls');

  const backends = resolve();

  // Rule 5: availability is a result, reported before and separately from scores.
  console.log('\n=== backend availability ===');
  for (const b of backends) {
    console.log(`  ${b.available ? 'AVAILABLE  ' : 'UNAVAILABLE'} ${b.id.padEnd(12)} ${b.available ? b.model : b.unavailableReason}`);
  }
  let live = backends.filter((b) => b.available);
  if (onlyBackends) live = live.filter((b) => onlyBackends.has(b.id));
  if (live.length === 0) { console.error('\nno available backends; nothing to run'); process.exit(2); }

  const forms = FORMS.filter((f) => !onlyForms || onlyForms.has(f.id));
  const tasks = TASKS.filter((t) => !onlyTasks || onlyTasks.has(t.id));
  // A mistyped id used to silently select nothing, which reads downstream as a
  // form or task that produced no data rather than one that never ran.
  for (const [label, req, got] of [['form', onlyForms, forms], ['task', onlyTasks, tasks]]) {
    if (!req) continue;
    const missing = [...req].filter((id) => !got.some((x) => x.id === id));
    if (missing.length) { console.error(`\nunknown ${label} id(s): ${missing.join(', ')}`); process.exit(2); }
  }
  // The run directory is created only once every argument has been accepted.
  // Creating it first left an empty, unindexed directory behind on every
  // rejected invocation — litter in exactly the tree whose only claim is that
  // each directory in it is a run that happened.
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(__dirname, 'runs', runId);
  fs.mkdirSync(runDir, { recursive: true });

  const allToolNames = TOOLS.map((t) => t.name);

  // Backends run in parallel; cells within a backend run serially so no single
  // upstream sees concurrent load from us.
  const perBackend = await Promise.all(
    live.map(async (b) => {
      const out = [];
      if (!skipControls) {
        for (const form of forms) {
          for (const c of CONTROLS) {
            const task = TASKS.find((t) => t.id === c.taskId);
            const r = await runCell({ backend: b, form, task, toolNames: c.toolNames, runDir, cellId: `ctl_${b.id}_${form.id}_${c.id}` });
            r.isControl = true; r.controlId = c.id;
            out.push(r);
            console.log(`  [ctl ] ${b.id.padEnd(12)} ${form.id} ${c.id.padEnd(8)} -> ${r.outcome}${r.errorDetail ? '  (' + String(r.errorDetail).slice(0, 60) + ')' : ''}`);
          }
        }
      }
      if (!skipBaseline) {
        for (const task of tasks) {
          const r = await runBaseline({ backend: b, task, runDir, cellId: `base_${b.id}_${task.id}` });
          r.isBaseline = true;
          out.push(r);
          console.log(`  [base] ${b.id.padEnd(12)} S0 ${task.id}       -> ${r.outcome}${r.errorDetail ? '  (' + String(r.errorDetail).slice(0, 60) + ')' : ''}`);
        }
      }
      for (const form of forms) {
        for (const task of tasks) {
          const r = await runCell({ backend: b, form, task, toolNames: allToolNames, runDir, cellId: `grid_${b.id}_${form.id}_${task.id}` });
          out.push(r);
          console.log(`  [grid] ${b.id.padEnd(12)} ${form.id} ${task.id}       -> ${r.outcome}${r.errorDetail ? '  (' + String(r.errorDetail).slice(0, 60) + ')' : ''}`);
        }
      }
      return out;
    })
  );
  const records = perBackend.flat();

  fs.writeFileSync(path.join(runDir, 'records.json'), JSON.stringify({ runId, maxTurns: MAX_TURNS, argv: process.argv.slice(2), backends: backends.map(({ apiKey, ...b }) => b), records }, null, 2));
  report(records, live, runDir, forms);
}

function report(records, live, runDir, formDefs) {
  const grid = records.filter((r) => !r.isControl && !r.isBaseline);
  const forms = (formDefs || FORMS).map((f) => f.id);

  console.log('\n\n================ RESULTS ================');
  console.log(`\nraw cells persisted to: ${runDir}`);

  console.log('\n--- OK rate by backend x form (grid only, n=3 tasks per cell) ---');
  console.log('backend'.padEnd(14) + forms.map((f) => f.padEnd(9)).join('') + 'spread');
  const spreads = [];
  for (const b of live) {
    const rates = forms.map((f) => {
      const cells = grid.filter((r) => r.backend === b.id && r.form === f);
      const scored = cells.filter((r) => r.outcome !== 'ERROR');
      if (scored.length === 0) return null;
      return cells.filter((r) => r.outcome === 'OK').length / scored.length;
    });
    const valid = rates.filter((r) => r !== null);
    const spread = valid.length >= 2 ? Math.max(...valid) - Math.min(...valid) : null;
    if (spread !== null) spreads.push({ backend: b.id, spread });
    console.log(
      b.id.padEnd(14) +
        rates.map((r) => (r === null ? 'n/a'.padEnd(9) : r.toFixed(2).padEnd(9))).join('') +
        (spread === null ? 'n/a' : spread.toFixed(2))
    );
  }

  // THE DIAGNOSTIC TABLE. The backend x form view answers "does the envelope
  // matter on average"; this one answers "where". The axes were chosen because
  // they are governed by the envelope, so a difference concentrated in
  // argument-structure or escaping means something a difference smeared across
  // all axes would not.
  console.log('\n--- OK rate by form x task axis (the diagnostic view) ---');
  const axes = [...new Set(TASKS.map((t) => t.axis))].filter((a) => grid.some((r) => TASKS.find((t) => t.id === r.task).axis === a));
  console.log('form'.padEnd(8) + axes.map((a) => a.padEnd(20)).join(''));
  for (const f of forms) {
    const row = axes.map((a) => {
      const cells = grid.filter((r) => r.form === f && TASKS.find((t) => t.id === r.task).axis === a && r.outcome !== 'ERROR');
      if (!cells.length) return 'n/a'.padEnd(20);
      const ok = cells.filter((r) => r.outcome === 'OK').length;
      return `${ok}/${cells.length}`.padEnd(20);
    });
    console.log(f.padEnd(8) + row.join(''));
  }
  console.log('  (cell = OK / scored, pooled across backends; ERROR excluded)');

  // Prompt-embedded XML carries text only, so structured values must arrive
  // JSON-encoded. Whether models do that, and whether it then works, is the
  // mechanism-level prediction this slice was built to test.
  console.log('\n--- structured-argument coercion (text-only envelopes must encode) ---');
  console.log('form'.padEnd(8) + 'cells needing coercion'.padEnd(26) + 'of which OK');
  for (const f of forms) {
    const cells = grid.filter((r) => r.form === f && r.flags && r.flags.coercions && r.flags.coercions.length);
    const ok = cells.filter((r) => r.outcome === 'OK').length;
    console.log(f.padEnd(8) + String(cells.length).padEnd(26) + (cells.length ? `${ok}/${cells.length}` : '-'));
  }
  const coercedKinds = {};
  for (const r of grid) for (const c of (r.flags && r.flags.coercions) || []) coercedKinds[c] = (coercedKinds[c] || 0) + 1;
  if (Object.keys(coercedKinds).length) console.log(`  coercions seen: ${JSON.stringify(coercedKinds)}`);

  const distractorCells = grid.filter((r) => r.flags && r.flags.calledDistractor);
  console.log(`\n--- near-synonym distractor selected in ${distractorCells.length}/${grid.length} cells ---`);
  if (distractorCells.length) console.log('  ' + distractorCells.map((r) => `${r.backend}/${r.form}/${r.task}`).join(', '));

  console.log('\n--- outcome distribution (grid) ---');
  const codes = ['OK', 'F0', 'F1', 'F2', 'F3', 'F4', 'ERROR'];
  console.log('form'.padEnd(8) + codes.map((c) => c.padEnd(7)).join(''));
  for (const f of forms) {
    const cells = grid.filter((r) => r.form === f);
    console.log(f.padEnd(8) + codes.map((c) => String(cells.filter((r) => r.outcome === c).length).padEnd(7)).join(''));
  }

  // How much of "it works" is actually parser tolerance? A call in a dialect
  // other than the one the prompt specified would be rejected by a scaffold
  // that only accepts its own literal syntax. Reporting tolerant-OK alone
  // overstates drivability; reporting strict-OK alone lets a regex masquerade
  // as a finding about the model. Both, always.
  console.log('\n--- tolerant vs strict OK (prompt-embedded forms) ---');
  console.log('form'.padEnd(8) + 'tolerantOK'.padEnd(12) + 'strictOK'.padEnd(10) + 'cells rescued by tolerance');
  for (const f of forms) {
    const cells = grid.filter((r) => r.form === f && r.outcome !== 'ERROR');
    if (!cells.length) continue;
    const tolerant = cells.filter((r) => r.outcome === 'OK');
    const rescued = tolerant.filter((r) => r.flags && r.flags.variantDialect);
    console.log(
      f.padEnd(8) +
        `${tolerant.length}/${cells.length}`.padEnd(12) +
        `${tolerant.length - rescued.length}/${cells.length}`.padEnd(10) +
        String(rescued.length)
    );
  }
  const anyVariant = grid.filter((r) => r.flags && r.flags.variantDialect);
  if (anyVariant.length) {
    console.log(`  cells where the model used a dialect other than the one specified: ${anyVariant.length}/${grid.length}`);
    console.log('  ' + anyVariant.map((r) => `${r.backend}/${r.form}/${r.task}`).join(', '));
  }

  console.log('\n--- controls ---');
  for (const b of live) {
    for (const f of forms) {
      const easy = records.find((r) => r.isControl && r.controlId === 'C-easy' && r.backend === b.id && r.form === f);
      const dense = records.find((r) => r.isControl && r.controlId === 'C-dense' && r.backend === b.id && r.form === f);
      const warn = easy && dense && easy.outcome === 'OK' && dense.outcome !== 'OK' ? '   <-- passes easy, fails dense' : '';
      console.log(`  ${b.id.padEnd(12)} ${f}  easy=${easy ? easy.outcome : '?'}  dense=${dense ? dense.outcome : '?'}${warn}`);
    }
  }

  console.log('\n--- construct check (S0 baseline: task competence without any tool protocol) ---');
  for (const b of live) {
    const bl = records.filter((r) => r.isBaseline && r.backend === b.id);
    const ok = bl.filter((r) => r.outcome === 'OK').length;
    console.log(`  ${b.id.padEnd(12)} ${ok}/${bl.length} tasks solved with no tools`);
  }

  // Rule 4: drops are a stratum until shown otherwise.
  const retried = records.filter((r) => (r.trace || []).some((t) => t.attempts > 1));
  if (retried.length) {
    const total = records.reduce((n, r) => n + ((r.trace || []).reduce((m, t) => m + ((t.attempts || 1) - 1), 0)), 0);
    console.log(`
--- transport retries: ${total} across ${retried.length} cells (5xx / network only; never retried a real reply) ---`);
  }

  const errors = records.filter((r) => r.outcome === 'ERROR');
  console.log(`\n--- ERROR cells: ${errors.length} ---`);
  if (errors.length) {
    const byForm = {};
    const byBackend = {};
    for (const e of errors) {
      byForm[e.form] = (byForm[e.form] || 0) + 1;
      byBackend[e.backend] = (byBackend[e.backend] || 0) + 1;
      console.log(`  ${e.cellId}: ${e.errorDetail}`);
    }
    console.log(`  clustering by form:    ${JSON.stringify(byForm)}`);
    console.log(`  clustering by backend: ${JSON.stringify(byBackend)}`);
    console.log('  ERROR cells are NOT counted as model failures and are excluded from OK rates.');
  }

  console.log('\n--- Slice 0 verdict (BENCH-DESIGN.md section 4) ---');
  const withinMax = spreads.length ? Math.max(...spreads.map((s) => s.spread)) : null;
  const meanByForm = forms.map((f) => {
    const cells = grid.filter((r) => r.form === f && r.outcome !== 'ERROR');
    return cells.length ? cells.filter((r) => r.outcome === 'OK').length / cells.length : null;
  }).filter((x) => x !== null);
  const betweenBackend = (() => {
    const per = live.map((b) => {
      const cells = grid.filter((r) => r.backend === b.id && r.outcome !== 'ERROR');
      return cells.length ? cells.filter((r) => r.outcome === 'OK').length / cells.length : null;
    }).filter((x) => x !== null);
    return per.length >= 2 ? Math.max(...per) - Math.min(...per) : null;
  })();
  console.log(`  max within-model spread across forms : ${withinMax === null ? 'n/a' : withinMax.toFixed(2)}`);
  console.log(`  between-model spread (all forms)     : ${betweenBackend === null ? 'n/a' : betweenBackend.toFixed(2)}`);
  console.log(`  form means                           : ${meanByForm.map((m) => m.toFixed(2)).join(' / ')}`);
  // CEILING / FLOOR GUARD — added after the first run, which produced
  // spread=0.00 everywhere and would otherwise have printed
  // "falsification condition 1 fires" as if that were a finding.
  //
  // Zero spread at a 1.00 mean is not a null result. It is an instrument with
  // no discriminative power: every cell saturated, so no difference of any size
  // could have shown up. Reading it as "schema form does not matter" is the
  // same error as certifying a sensitivity from a control that was too easy.
  // The falsification condition is only evaluable away from the rails.
  const scored = grid.filter((r) => r.outcome !== 'ERROR');
  const overall = scored.length ? scored.filter((r) => r.outcome === 'OK').length / scored.length : null;
  const SATURATED = overall !== null && (overall >= 0.9 || overall <= 0.1);
  console.log(`  overall OK rate (grid, ERROR excluded) : ${overall === null ? 'n/a' : overall.toFixed(2)}  (${scored.filter((r) => r.outcome === 'OK').length}/${scored.length})`);

  if (SATURATED) {
    console.log(`\n  -> NO DISCRIMINATIVE POWER. The grid is saturated at ${overall >= 0.9 ? 'ceiling' : 'floor'}.`);
    console.log('     Spread is 0 because every cell is at the rail, not because the forms are equivalent.');
    console.log('     Falsification condition 1 CANNOT be evaluated from this run and must not be reported as fired.');
    console.log('     Required before expanding: raise task difficulty until the grid produces variance.');
  } else if (withinMax !== null && betweenBackend !== null) {
    console.log(
      withinMax > betweenBackend
        ? '  -> within-model spread EXCEEDS between-model spread: schema form is a first-order effect. Proceed.'
        : '  -> within-model spread does NOT exceed between-model spread: falsification condition 1 fires. Report the negative result; do not expand the grid.'
    );
  }
  console.log('\n  n=3 tasks per cell. This is a screen, not an estimate. Do not quote these rates as measurements.');
  console.log('=========================================\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
