'use strict';

/** Slice 0.8 analysis from runs/<runId>/summary.json.  node analyze08.js runs/<runId> */
const fs = require('fs');
const path = require('path');
const { fisherTwoSided } = require('./analyze05');

function decide(rows) {
  const om = rows.filter((r) => r.original === 'omit' && r.cls !== 'ERROR');
  const creates = om.filter((r) => r.cls === 'create-ok' || r.cls === 'create-omit');
  const k = creates.filter((r) => r.cls === 'create-omit').length;
  if (creates.length < 8) return { verdict: 'INCONCLUSIVE (fewer than 8 create replies)', k, n: creates.length };
  const p = k / creates.length;
  return { verdict: p >= 0.5 ? 'CONTENT REPRODUCES IT' : p <= 0.1 ? 'CONTENT DOES NOT REPRODUCE IT' : 'INCONCLUSIVE (between thresholds)', k, n: creates.length };
}

function main() {
  const dir = process.argv[2];
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  console.log(`\n=== Slice 0.8 — ${s.runId} — ${s.rows.length} replays; pool ${JSON.stringify(s.poolCounts)}; excluded by size ${s.excludedSize} ===`);
  for (const orig of ['omit', 'ok']) {
    const rs = s.rows.filter((r) => r.original === orig);
    const c = {};
    rs.forEach((r) => { c[r.cls] = (c[r.cls] || 0) + 1; });
    const cr = rs.filter((r) => r.cls.startsWith('create'));
    console.log(`  original=${orig.padEnd(4)} n=${rs.length}  ${JSON.stringify(c)}  create replies with summary: ${cr.filter((r) => r.summary).length}/${cr.length}  empty-reasoning fallback: ${rs.filter((r) => r.emptyReasoning).length}`);
  }
  const d = decide(s.rows);
  console.log(`\n  primary: omission among omission-prefix create replies = ${d.k}/${d.n}\n  -> ${d.verdict}`);
  const ctl = s.rows.filter((r) => r.original === 'ok' && r.cls.startsWith('create'));
  if (ctl.length) {
    const kc = ctl.filter((r) => r.cls === 'create-omit').length;
    console.log(`  control (original ok): ${kc}/${ctl.length} omit; Fisher vs primary p = ${fisherTwoSided(d.k, d.n - d.k, kc, ctl.length - kc).toFixed(4)}`);
  }
  const u = s.rows.map((r) => r.usage || {});
  console.log(`  tokens: prompt ${u.reduce((a, x) => a + (x.prompt_tokens || 0), 0)}, completion ${u.reduce((a, x) => a + (x.completion_tokens || 0), 0)}`);
}

module.exports = { decide };
if (require.main === module) main();
