'use strict';

/**
 * Slice 0.5 analysis. Recomputes every pre-registered measure from persisted
 * cells; never re-runs anything.
 *
 *   node analyze05.js runs/<runId>
 *
 * Measures (BENCH-DESIGN.md, pre-registration 2026-10-04):
 *   primary    content-omission rate per backend x arm, call-level AND cell-level
 *   secondary  identical repeat after an omission error; irrelevant arguments;
 *              command-absent calls (own code); outcome codes; turns
 *   guards     S0 baselines (L2 excluded for a backend that fails its L2 baseline;
 *              K3 if a backend fails both); ERROR cells excluded and listed
 */

const fs = require('fs');
const path = require('path');
const { CONTENT_OPS } = require('./slice05');

function load(dir) {
  const recs = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'records.json') continue;
    recs.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  }
  return recs;
}

const callKey = (c) => JSON.stringify([c.name, c.args]);

/** Pure: per-cell measures. Exported for the offline assertions. */
function cellMeasures(rec) {
  const calls = (rec.calls || []).filter((c) => !c.malformed);
  const content = calls.filter((c) => c.op && CONTENT_OPS.has(c.op));
  const omissions = content.filter((c) => c.missing && c.missing.length);
  let repeats = 0, followed = 0;
  calls.forEach((c, i) => {
    if (!(c.op && CONTENT_OPS.has(c.op) && c.missing && c.missing.length)) return;
    const next = calls[i + 1];
    if (!next) return;
    followed++;
    if (callKey(next) === callKey(c)) repeats++;
  });
  return {
    contentCalls: content.length,
    omissions: omissions.length,
    omittedParams: omissions.flatMap((c) => c.missing),
    createCalls: content.filter((c) => c.op === 'create').length,
    createOmissions: omissions.filter((c) => c.op === 'create').length,
    commandAbsent: calls.filter((c) => c.commandAbsent).length,
    irrelevantCalls: calls.filter((c) => c.irrelevant && c.irrelevant.length).length,
    totalCalls: calls.length,
    repeatsAfterOmission: repeats,
    omissionsFollowed: followed,
    malformed: (rec.calls || []).filter((c) => c.malformed).length,
  };
}

const isK3Model = (model) => /kimi[-_ ]?k3/i.test(model || '');

function fisherTwoSided(a, b, c, d) {
  // 2x2 [[a,b],[c,d]]; exact two-sided p by summing tables no more likely than observed.
  const lf = (n) => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
  const r1 = a + b, r2 = c + d, c1 = a + c, n = r1 + r2;
  const p = (x) => Math.exp(lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 - c1 + x));
  const obs = p(a);
  let s = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) { const px = p(x); if (px <= obs * (1 + 1e-9)) s += px; }
  return Math.min(1, s);
}

function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(dir)) { console.error('usage: node analyze05.js runs/<runId>'); process.exit(2); }
  const recs = load(dir);
  const base = recs.filter((r) => r.isBaseline);
  const cells = recs.filter((r) => !r.isBaseline && r.arm);
  const backends = [...new Set(cells.map((r) => r.backend))].sort();

  console.log(`\n=== Slice 0.5 — ${path.basename(dir)} — ${cells.length} cells, ${base.length} baselines ===`);

  console.log('\n--- S0 baselines (construct guard) ---');
  const excludeL2 = new Set(), k3 = new Set();
  for (const b of backends) {
    const bl = base.filter((r) => r.backend === b);
    const l2 = bl.find((r) => r.task === 'L2'), l1 = bl.find((r) => r.task === 'L1');
    console.log(`  ${b.padEnd(11)} L1=${l1 ? l1.outcome : '-'}  L2=${l2 ? l2.outcome : '-'}`);
    // Only a scored failure (F3) is evidence about competence. An ERROR baseline
    // (transport) says nothing, and treating it as a failure fired K3 on a
    // retired backend whose every request was a 400.
    if (l2 && l2.outcome === 'F3') excludeL2.add(b);
    if (l1 && l2 && l1.outcome === 'F3' && l2.outcome === 'F3') k3.add(b);
  }
  if (excludeL2.size) console.log(`  L2 excluded from the primary measure for: ${[...excludeL2].join(', ')} (failed L2 with no tools)`);
  if (k3.size) console.log(`  K3 FIRES for: ${[...k3].join(', ')} — failed both baselines; tool cells measure competence`);

  const errors = cells.filter((r) => r.outcome === 'ERROR');
  const scored = cells.filter((r) => r.outcome !== 'ERROR');
  // Prediction 2 and K1 are about Kimi K3 specifically. Matching on "kimi" would
  // let a different checkpoint (K2.6, retired mid-run on 2026-10-04 and all
  // ERROR) stand in for it, and its presence would also suppress the caveat
  // that K3 is absent. Only a K3 model id with scored cells counts.
  const isK3 = (b) => scored.some((r) => r.backend === b && isK3Model(r.model));
  const noScored = backends.filter((b) => !scored.some((r) => r.backend === b));
  if (noScored.length) console.log(`\n  backends with no scored cell (all ERROR) — absent from every measure: ${noScored.join(', ')}`);
  const inPrimary = (r) => !(r.task === 'L2' && excludeL2.has(r.backend));

  console.log('\n--- PRIMARY: content-omission (ERROR cells excluded) ---');
  console.log('backend'.padEnd(12) + 'arm'.padEnd(7) + 'omit/content'.padEnd(15) + 'rate'.padEnd(8) + 'cells w/ omit'.padEnd(15) + 'create omit'.padEnd(13) + 'params omitted');
  const verdict = {};
  for (const b of backends) {
    verdict[b] = {};
    for (const a of ['MUX', 'SPLIT']) {
      const cs = scored.filter((r) => r.backend === b && r.arm === a && inPrimary(r));
      if (!cs.length) continue;
      const m = cs.map(cellMeasures);
      const sum = (k) => m.reduce((s, x) => s + x[k], 0);
      const cellsWith = m.filter((x) => x.omissions > 0).length;
      const params = {};
      m.flatMap((x) => x.omittedParams).forEach((p) => { params[p] = (params[p] || 0) + 1; });
      verdict[b][a] = { omissions: sum('omissions'), content: sum('contentCalls'), cellsWith, cells: cs.length, createOm: sum('createOmissions'), create: sum('createCalls') };
      const rate = sum('contentCalls') ? (sum('omissions') / sum('contentCalls')).toFixed(3) : 'n/a';
      console.log(b.padEnd(12) + a.padEnd(7) + `${sum('omissions')}/${sum('contentCalls')}`.padEnd(15) + String(rate).padEnd(8) + `${cellsWith}/${cs.length}`.padEnd(15) + `${sum('createOmissions')}/${sum('createCalls')}`.padEnd(13) + JSON.stringify(params));
    }
    const v = verdict[b];
    if (v.MUX && v.SPLIT) {
      const p = fisherTwoSided(v.MUX.cellsWith, v.MUX.cells - v.MUX.cellsWith, v.SPLIT.cellsWith, v.SPLIT.cells - v.SPLIT.cellsWith);
      console.log(' '.repeat(12) + `cell-level MUX vs SPLIT: Fisher exact two-sided p = ${p.toFixed(3)}`);
    }
  }

  console.log('\n--- omissions by task (all backends, ERROR excluded) ---');
  const tasks = [...new Set(cells.map((r) => r.task))].sort();
  console.log('arm'.padEnd(7) + tasks.map((t) => t.padEnd(10)).join(''));
  for (const a of ['MUX', 'SPLIT']) {
    console.log(a.padEnd(7) + tasks.map((t) => {
      const m = scored.filter((r) => r.arm === a && r.task === t).map(cellMeasures);
      return `${m.reduce((s, x) => s + x.omissions, 0)}/${m.reduce((s, x) => s + x.contentCalls, 0)}`.padEnd(10);
    }).join(''));
  }

  console.log('\n--- SECONDARY ---');
  console.log('backend'.padEnd(12) + 'arm'.padEnd(7) + 'repeat-after-omit'.padEnd(19) + 'cmd-absent'.padEnd(12) + 'irrelevant-arg calls'.padEnd(22) + 'malformed'.padEnd(11) + 'outcomes');
  for (const b of backends) {
    for (const a of ['MUX', 'SPLIT']) {
      const cs = cells.filter((r) => r.backend === b && r.arm === a);
      if (!cs.length) continue;
      const m = cs.filter((r) => r.outcome !== 'ERROR').map(cellMeasures);
      const sum = (k) => m.reduce((s, x) => s + x[k], 0);
      const oc = {};
      cs.forEach((r) => { oc[r.outcome] = (oc[r.outcome] || 0) + 1; });
      console.log(b.padEnd(12) + a.padEnd(7) + `${sum('repeatsAfterOmission')}/${sum('omissionsFollowed')}`.padEnd(19) + String(sum('commandAbsent')).padEnd(12) + `${sum('irrelevantCalls')}/${sum('totalCalls')}`.padEnd(22) + String(sum('malformed')).padEnd(11) + JSON.stringify(oc));
    }
  }

  console.log(`\n--- ERROR cells: ${errors.length} (not model evidence; excluded) ---`);
  errors.forEach((r) => console.log(`  ${r.cellId}: ${r.errorDetail}`));
  const retried = cells.reduce((n, r) => n + (r.trace || []).reduce((m, t) => m + ((t.attempts || 1) - 1), 0), 0);
  if (retried) console.log(`  transport retries across all cells: ${retried}`);

  console.log('\n--- pre-registered predictions and kill conditions ---');
  for (const b of backends) {
    const v = verdict[b];
    if (!v.MUX || !v.SPLIT) continue;
    const line = [];
    if (['ds-direct', 'ds-gateway', 'glm-flash'].includes(b)) {
      const ok = v.MUX.omissions <= 1 && v.SPLIT.omissions <= 1;
      line.push(`P1 (≤1 omission per arm): ${ok ? 'HOLDS' : 'FAILS'}`);
    }
    if (isK3(b)) {
      if (v.MUX.create < 20) line.push(`P2/K1 not evaluable: ${v.MUX.create} MUX create calls (< 20)`);
      else {
        const r = v.MUX.createOm / v.MUX.create;
        line.push(`MUX create omission ${(100 * r).toFixed(1)}% — ${r < 0.05 ? 'K1 FIRES' : r >= 0.2 ? 'P2 HOLDS' : 'between thresholds'}`);
      }
    }
    if (v.MUX.omissions + v.SPLIT.omissions > 0) {
      const rm = v.MUX.content ? v.MUX.omissions / v.MUX.content : 0;
      const rs = v.SPLIT.content ? v.SPLIT.omissions / v.SPLIT.content : 0;
      line.push(rs >= rm ? `K2 FIRES (SPLIT ${rs.toFixed(3)} >= MUX ${rm.toFixed(3)})` : `K2 does not fire (MUX ${rm.toFixed(3)} > SPLIT ${rs.toFixed(3)})`);
    } else line.push('no omissions in either arm');
    console.log(`  ${b.padEnd(11)} ${line.join(' | ')}`);
  }
  if (!backends.some(isK3)) {
    console.log('\n  Kimi K3 absent: an all-null result here shows only that MUX imposes no general penalty on');
    console.log('  these backends. It is NOT evidence against OPEN-CODING-02 §3.4 (pre-registered caveat).');
  }
}

module.exports = { cellMeasures, fisherTwoSided, isK3Model };
if (require.main === module) main();
