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
  const c = classify({ flags: r.flags, verify: r.verify, transportOutcome: before === 'ERROR' ? 'ERROR' : null });
  if (c.outcome !== before) reclassified.push({ cellId: r.cellId, before, after: c.outcome, detail: r.verify && r.verify.detail });
  r.outcome = c.outcome;
  r.recovered = c.recovered;
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
console.log('form'.padEnd(8) + 'variantDialect'.padEnd(16) + 'coercions'.padEnd(12) + 'parallelCalls'.padEnd(15) + 'malformed');
for (const f of forms) {
  const cells = grid.filter((r) => r.form === f);
  const d = cells.filter((r) => r.flags && r.flags.variantDialect).length;
  const c = cells.filter((r) => r.flags && r.flags.coercions && r.flags.coercions.length).length;
  const p = cells.filter((r) => r.flags && r.flags.parallelCalls > 1).length;
  const m = cells.filter((r) => r.flags && r.flags.anyMalformed).length;
  console.log(f.padEnd(8) + `${d}/${cells.length}`.padEnd(16) + `${c}/${cells.length}`.padEnd(12) + `${p}/${cells.length}`.padEnd(15) + `${m}/${cells.length}`);
}
console.log('  These are the differences a binary OK rate erases. "It worked" is not "it cost the same".');

/* --------------------------------------------------------------------------
 * Strict-parser projection.
 * ----------------------------------------------------------------------- */
console.log('\n--- projected OK under a STRICT scaffold (rejects non-specified dialect) ---');
console.log('form'.padEnd(8) + 'tolerant'.padEnd(12) + 'strict'.padEnd(12) + 'delta');
for (const f of forms) {
  const scored = grid.filter((r) => r.form === f && r.outcome !== 'ERROR');
  const tol = scored.filter((r) => r.outcome === 'OK');
  const strict = tol.filter((r) => !(r.flags && r.flags.variantDialect));
  console.log(
    f.padEnd(8) +
      pct(tol.length, scored.length).padEnd(12) +
      pct(strict.length, scored.length).padEnd(12) +
      (scored.length ? `-${((tol.length - strict.length) / scored.length).toFixed(2)}` : 'n/a')
  );
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
