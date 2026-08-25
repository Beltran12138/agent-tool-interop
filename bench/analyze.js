'use strict';

/**
 * Offline analysis over a completed run's records.json.
 *
 * Separate from run.js on purpose: adding a metric must never require paying
 * for the grid again. Anything computed here is computed from persisted traces,
 * so a number that cannot be recomputed from disk cannot appear in a report.
 *
 * Usage: node analyze.js [runDir]   (defaults to the newest run)
 */

const fs = require('fs');
const path = require('path');

const runsDir = path.join(__dirname, 'runs');
const runDir = process.argv[2] ||
  path.join(runsDir, fs.readdirSync(runsDir)
    .filter((d) => fs.existsSync(path.join(runsDir, d, 'records.json')))
    .sort().pop());

const { classify } = require('./classify');

const { records } = JSON.parse(fs.readFileSync(path.join(runDir, 'records.json'), 'utf8'));

// Re-score every persisted cell with the current classifier. Cells are never
// re-run to change a number: if the rule changes, the rule is re-applied to the
// traces already on disk, and any cell whose code moves is listed below rather
// than quietly replaced.
const reclassified = [];
for (const r of records) {
  if (r.isBaseline || !r.flags) continue;
  const before = r.outcome;
  const t = before === 'ERROR' ? 'ERROR' : null;
  const strict = classify({ flags: r.flags, verify: r.verify, transportOutcome: t, strict: true });
  const tolerant = classify({ flags: r.flags, verify: r.verify, transportOutcome: t });
  if (strict.outcome !== before) reclassified.push({ cellId: r.cellId, before, after: strict.outcome, detail: r.verify && r.verify.detail });
  r.outcome = strict.outcome;
  r.outcomeTolerant = tolerant.outcome;
  r.recovered = strict.recovered || tolerant.recovered;
}
if (reclassified.length) {
  console.log('\n--- cells re-scored by the current classifier (recomputed from disk, not re-run) ---');
  for (const x of reclassified) console.log(`  ${x.cellId}: ${x.before} -> ${x.after}   (${x.detail || ''})`);
}

const grid = records.filter((r) => !r.isControl && !r.isBaseline);
const forms = [...new Set(grid.map((r) => r.form))].sort();
const backends = [...new Set(grid.map((r) => r.backend))];

function pct(n, d) { return d ? (n / d).toFixed(2) : 'n/a'; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

console.log(`\nrun: ${path.basename(runDir)}   grid cells: ${grid.length}\n`);

/* --------------------------------------------------------------------------
 * Strict vs tolerant — the Slice 0.2 dependent variable.
 * ----------------------------------------------------------------------- */
function rate(cells, key) {
  const scored = cells.filter((r) => r[key] !== 'ERROR');
  return scored.length ? { ok: scored.filter((r) => r[key] === 'OK').length, n: scored.length } : null;
}
function fmt(r) { return r ? `${r.ok}/${r.n} ${(r.ok / r.n).toFixed(2)}` : 'n/a'; }

console.log('--- PRIMARY: strict scoring (conformance is part of the outcome) ---');
console.log('backend'.padEnd(14) + forms.map((f) => f.padEnd(14)).join(''));
for (const b of backends) {
  console.log(b.padEnd(14) + forms.map((f) => fmt(rate(grid.filter((r) => r.backend === b && r.form === f), 'outcome')).padEnd(14)).join(''));
}
console.log('ALL'.padEnd(14) + forms.map((f) => fmt(rate(grid.filter((r) => r.form === f), 'outcome')).padEnd(14)).join(''));

console.log('\n--- same cells, tolerant scoring (what a lenient consumer would report) ---');
console.log('ALL'.padEnd(14) + forms.map((f) => fmt(rate(grid.filter((r) => r.form === f), 'outcomeTolerant')).padEnd(14)).join(''));

/* --------------------------------------------------------------------------
 * Competence gating.
 *
 * The S0 baseline is not a number to print beside the grid — it is a gate on
 * whether a grid cell can be read as an envelope effect at all. If a backend
 * cannot produce the required answer with NO tool protocol, its failure with an
 * envelope says nothing about the envelope. Those cells are excluded from the
 * adjusted view and counted openly, rather than being left in to make one form
 * look worse than it is.
 * ----------------------------------------------------------------------- */
const baselineOk = new Set(
  records.filter((r) => r.isBaseline && r.outcome === 'OK').map((r) => `${r.backend}|${r.task}`)
);
const baselineRan = new Set(records.filter((r) => r.isBaseline).map((r) => `${r.backend}|${r.task}`));
const gated = grid.filter((r) => baselineOk.has(`${r.backend}|${r.task}`));
const excluded = grid.filter((r) => baselineRan.has(`${r.backend}|${r.task}`) && !baselineOk.has(`${r.backend}|${r.task}`));

console.log('\n--- competence-gated: only (backend, task) pairs the backend solved with NO tools ---');
console.log('ALL'.padEnd(14) + forms.map((f) => fmt(rate(gated.filter((r) => r.form === f), 'outcome')).padEnd(14)).join(''));
if (excluded.length) {
  const pairs = [...new Set(excluded.map((r) => `${r.backend}/${r.task}`))];
  console.log(`  excluded ${excluded.length} cells from ${pairs.length} pair(s) whose no-tools baseline failed: ${pairs.join(', ')}`);
  console.log('  A backend that cannot do the task bare cannot tell us anything about the envelope.');
}

/* --------------------------------------------------------------------------
 * Graded measures.
 *
 * A binary OK rate saturates the moment every backend can complete every task,
 * and then reports 0.00 spread regardless of how differently the envelopes
 * behaved on the way. Turn count and retry-to-recover do not saturate: they
 * keep measuring after "did it work" has stopped discriminating.
 * ----------------------------------------------------------------------- */
console.log('--- turns to completion (OK cells only; graded, does not saturate) ---');
console.log('backend'.padEnd(14) + forms.map((f) => f.padEnd(10)).join(''));
for (const b of backends) {
  const row = forms.map((f) => {
    const t = grid.filter((r) => r.backend === b && r.form === f && r.outcome === 'OK').map((r) => r.turns);
    const m = mean(t);
    return (m === null ? 'n/a' : m.toFixed(1)).padEnd(10);
  });
  console.log(b.padEnd(14) + row.join(''));
}
{
  const perForm = forms.map((f) => mean(grid.filter((r) => r.form === f && r.outcome === 'OK').map((r) => r.turns)));
  console.log('ALL'.padEnd(14) + perForm.map((m) => (m === null ? 'n/a' : m.toFixed(1)).padEnd(10)).join(''));
}

console.log('\n--- malformed-then-recovered (envelope friction that OK hides) ---');
console.log('form'.padEnd(8) + 'cells with >=1 malformed'.padEnd(28) + 'of those, still OK');
for (const f of forms) {
  const cells = grid.filter((r) => r.form === f && r.flags && r.flags.anyMalformed);
  console.log(f.padEnd(8) + String(cells.length).padEnd(28) + `${cells.filter((r) => r.outcome === 'OK').length}/${cells.length || 0}`);
}

console.log('\n--- what each envelope DEMANDED to reach the same outcome ---');
console.log('form'.padEnd(8) + 'variantDialect'.padEnd(16) + 'coercions'.padEnd(12) + 'parallelCalls'.padEnd(15) + 'escaping'.padEnd(11) + 'paramSyntaxFail'.padEnd(17) + 'malformed');
for (const f of forms) {
  const cells = grid.filter((r) => r.form === f);
  const d = cells.filter((r) => r.flags && r.flags.variantDialect).length;
  const c = cells.filter((r) => r.flags && r.flags.coercions && r.flags.coercions.length).length;
  const p = cells.filter((r) => r.flags && r.flags.parallelCalls > 1).length;
  const m = cells.filter((r) => r.flags && r.flags.anyMalformed).length;
  const e = cells.filter((r) => r.flags && r.flags.escapingUsed).length;
  const ps = cells.filter((r) => r.flags && r.flags.paramSyntaxFailure).length;
  console.log(f.padEnd(8) + `${d}/${cells.length}`.padEnd(16) + `${c}/${cells.length}`.padEnd(12) + `${p}/${cells.length}`.padEnd(15) + `${e}/${cells.length}`.padEnd(11) + `${ps}/${cells.length}`.padEnd(17) + `${m}/${cells.length}`);
}
console.log('  These are the differences a binary OK rate erases. "It worked" is not "it cost the same".');

/* --------------------------------------------------------------------------
 * Strict-parser projection.
 * ----------------------------------------------------------------------- */
// NOTE: an earlier version of this block projected strictness onto `outcome`.
// Once `outcome` itself became the strict code (Slice 0.2), that projection was
// comparing strict against strict and printed a delta of 0.00 for every form —
// which reads as "leniency makes no difference" while the tolerant/strict tables
// above show it costing one form 19 points. A stale metric that still prints a
// number is worse than a missing one. The comparison lives in the two tables at
// the top; what belongs here is the per-cell accounting of who was rejected.
const strictOnly = grid.filter((r) => r.outcome !== 'OK' && r.outcomeTolerant === 'OK');
console.log(`\n--- cells that PASS tolerant and FAIL strict: ${strictOnly.length}/${grid.length} ---`);
if (strictOnly.length) {
  console.log('  ' + strictOnly.map((r) => `${r.backend}/${r.form}/${r.task}`).join(', '));
  console.log('  Each of these is a call a scaffold accepting only its specified syntax would');
  console.log('  have rejected outright, and that a lenient benchmark would report as success.');
}

console.log('\n--- per task x form (strict), with axis ---');
const taskOrder = [...new Set(grid.map((r) => r.task))];
const axisOf = {};
for (const r of records) if (r.task && r.axisHint) axisOf[r.task] = r.axisHint;
console.log('task'.padEnd(6) + forms.map((f) => f.padEnd(9)).join('') + 'note');
for (const t of taskOrder) {
  const row = forms.map((f) => {
    const cells = grid.filter((r) => r.task === t && r.form === f && r.outcome !== 'ERROR');
    return (cells.length ? `${cells.filter((r) => r.outcome === 'OK').length}/${cells.length}` : 'n/a').padEnd(9);
  });
  const gatedOut = [...new Set(excluded.filter((r) => r.task === t).map((r) => r.backend))];
  console.log(t.padEnd(6) + row.join('') + (gatedOut.length ? `baseline failed for ${gatedOut.join(',')}` : ''));
}

/* --------------------------------------------------------------------------
 * Transport control.
 * ----------------------------------------------------------------------- */
const pair = ['ds-direct', 'ds-gateway'].filter((b) => backends.includes(b));
if (pair.length === 2) {
  console.log('\n--- transport control: same model family, two serving paths ---');
  console.log('form'.padEnd(8) + 'ds-direct'.padEnd(28) + 'ds-gateway');
  for (const f of forms) {
    const cell = (b) => {
      const cs = records.filter((r) => r.backend === b && r.form === f);
      const ok = cs.filter((r) => r.outcome === 'OK').length;
      const dia = cs.filter((r) => r.flags && r.flags.variantDialect).length;
      const mal = cs.filter((r) => r.flags && r.flags.anyMalformed).length;
      return `OK ${ok}/${cs.length} dialect${dia} malformed${mal}`;
    };
    console.log(f.padEnd(8) + cell('ds-direct').padEnd(28) + cell('ds-gateway'));
  }
  console.log('  ⚠ NOT the same checkpoint by assertion: the gateway serves a dated snapshot');
  console.log('    (…-0731) and the direct endpoint serves an unpinned name. A checkpoint');
  console.log('    difference is not excluded, so any gap here is "serving path OR version",');
  console.log('    not "serving path". Calling it a gateway effect would be the category');
  console.log('    error this project exists to name.');
}

/* --------------------------------------------------------------------------
 * Discriminative power.
 * ----------------------------------------------------------------------- */
const scored = grid.filter((r) => r.outcome !== 'ERROR');
const overall = scored.length ? scored.filter((r) => r.outcome === 'OK').length / scored.length : null;
console.log(`\n--- discriminative power ---`);
console.log(`  overall OK: ${pct(scored.filter((r) => r.outcome === 'OK').length, scored.length)} (${scored.filter((r) => r.outcome === 'OK').length}/${scored.length})`);
if (overall !== null && overall >= 0.9) {
  console.log('  BINARY OUTCOME IS SATURATED. Spread on OK rate is uninformative here.');
  console.log('  Read the graded measures above instead: they are what still varies once');
  console.log('  "did it work" has stopped separating anything.');
}
console.log('');
