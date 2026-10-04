'use strict';

/**
 * Slice 0.6 analysis, recomputed from persisted cells.
 *   node analyze06.js runs/<runId> [runs/<runId> ...]   (several runs are pooled)
 */

const fs = require('fs');
const path = require('path');
const { fisherTwoSided } = require('./analyze05');

/** Pure, per cell. Exported for the offline assertions. */
function cellMeasures(rec) {
  const calls = (rec.calls || []).filter((c) => !c.malformed);
  const creates = calls.filter((c) => c.name === 'file_editor' && c.op === 'create');
  const fe = calls.filter((c) => c.name === 'file_editor');
  const firstCreateIdx = calls.findIndex((c) => c.name === 'file_editor' && c.op === 'create');
  const before = firstCreateIdx === -1 ? calls : calls.slice(0, firstCreateIdx);
  let repeats = 0, followed = 0;
  calls.forEach((c, i) => {
    if (!(c.name === 'file_editor' && c.op === 'create' && c.missing.includes('file_text'))) return;
    const n = calls[i + 1];
    if (!n) return;
    followed++;
    if (JSON.stringify([n.name, n.args]) === JSON.stringify([c.name, c.args])) repeats++;
  });
  return {
    hasCreate: creates.length > 0,
    firstCreateOmits: creates.length ? creates[0].missing.includes('file_text') : null,
    creates: creates.length,
    createOmissions: creates.filter((c) => c.missing.includes('file_text')).length,
    feCalls: fe.length,
    feWithSummary: fe.filter((c) => (c.meta || []).includes('summary')).length,
    feWithRisk: fe.filter((c) => (c.meta || []).includes('security_risk')).length,
    terminalBeforeCreate: before.filter((c) => c.name === 'terminal').length,
    repeats, followed,
  };
}

function load(dirs) {
  const out = [];
  for (const d of dirs) for (const f of fs.readdirSync(d)) {
    if (f.startsWith('s06_') && f.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')));
  }
  return out;
}

function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) { console.error('usage: node analyze06.js runs/<runId> [...]'); process.exit(2); }
  const recs = load(dirs);
  const scored = recs.filter((r) => r.outcome !== 'ERROR');
  const arms = [...new Set(recs.map((r) => r.arm))];
  const order = ['OH', 'BASE', 'A-meta', 'A-desc', 'A-sys', 'A-solo'].filter((a) => arms.includes(a));
  console.log(`\n=== Slice 0.6 — ${dirs.map((d) => path.basename(d)).join(' + ')} — ${recs.length} cells (${recs.length - scored.length} ERROR) ===`);

  console.log('\n--- PRIMARY: first file_editor create lacks file_text ---');
  console.log('arm'.padEnd(8) + 'first-create omit'.padEnd(20) + 'cells w/o create'.padEnd(18) + 'all-create omit'.padEnd(17) + 'fe calls w/ summary'.padEnd(21) + 'w/ risk'.padEnd(10) + 'repeat-after-omit'.padEnd(19) + 'outcomes');
  const S = {};
  for (const a of order) {
    const cs = scored.filter((r) => r.arm === a);
    const m = cs.map(cellMeasures);
    const withC = m.filter((x) => x.hasCreate);
    const k = withC.filter((x) => x.firstCreateOmits).length;
    S[a] = { k, n: withC.length };
    const sum = (f) => m.reduce((s, x) => s + x[f], 0);
    const oc = {}; cs.forEach((r) => { oc[r.outcome] = (oc[r.outcome] || 0) + 1; });
    console.log(a.padEnd(8) + `${k}/${withC.length} (${withC.length ? (100 * k / withC.length).toFixed(0) : '-'}%)`.padEnd(20) + String(m.length - withC.length).padEnd(18) + `${sum('createOmissions')}/${sum('creates')}`.padEnd(17) + `${sum('feWithSummary')}/${sum('feCalls')}`.padEnd(21) + `${sum('feWithRisk')}/${sum('feCalls')}`.padEnd(10) + `${sum('repeats')}/${sum('followed')}`.padEnd(19) + JSON.stringify(oc));
  }

  console.log('\n--- by task (first-create omit / cells with a create) ---');
  const tasks = [...new Set(scored.map((r) => r.task))].sort();
  console.log('arm'.padEnd(8) + tasks.map((t) => t.padEnd(8)).join(''));
  for (const a of order) console.log(a.padEnd(8) + tasks.map((t) => {
    const m = scored.filter((r) => r.arm === a && r.task === t).map(cellMeasures).filter((x) => x.hasCreate);
    return `${m.filter((x) => x.firstCreateOmits).length}/${m.length}`.padEnd(8);
  }).join(''));

  console.log('\n--- pre-registered decision ---');
  if (S.OH && S.BASE && S.OH.n && S.BASE.n) {
    const pOH = S.OH.k / S.OH.n, pB = S.BASE.k / S.BASE.n;
    const p = fisherTwoSided(S.OH.k, S.OH.n - S.OH.k, S.BASE.k, S.BASE.n - S.BASE.k);
    console.log(`  Stage 1: OH ${(100 * pOH).toFixed(0)}% vs BASE ${(100 * pB).toFixed(0)}%  (Fisher p = ${p.toFixed(4)})`);
    if (pOH >= 0.5 && pB <= 0.1) console.log('  -> REPRODUCED. Stage 2 (ablations) is licensed.');
    else if (pOH <= 0.1) console.log('  -> NOT REPRODUCED. Prompt + tool surface is not sufficient on this serving path; Stage 2 does not run.');
    else console.log('  -> BETWEEN thresholds: add 6 repetitions to both arms once, then re-apply the rule to the pooled cells.');
  }
  for (const a of ['A-meta', 'A-desc', 'A-sys', 'A-solo']) {
    if (!S[a] || !S.OH || !S[a].n) continue;
    const drop = S.OH.k / S.OH.n - S[a].k / S[a].n;
    const p = fisherTwoSided(S.OH.k, S.OH.n - S.OH.k, S[a].k, S[a].n - S[a].k);
    console.log(`  ${a.padEnd(7)} drop ${(100 * drop).toFixed(0)} pp, p = ${p.toFixed(4)} -> ${drop >= 0.4 && p < 0.05 ? 'NECESSARY' : 'not shown necessary'}`);
  }
  const errs = recs.filter((r) => r.outcome === 'ERROR');
  if (errs.length) { console.log(`\n--- ERROR cells (excluded): ${errs.length}`); errs.forEach((r) => console.log(`  ${r.cellId}: ${r.errorDetail}`)); }
}

module.exports = { cellMeasures };
if (require.main === module) main();
