'use strict';

/**
 * Endpoint identity probe.
 *
 * The transport control compares one model family served two ways: a direct
 * vendor endpoint and a gateway. Slice 0.1 found a gap there and could not name
 * it, because the direct endpoint serves an unpinned model name while the
 * gateway serves a dated snapshot. "Serving path" and "model version" are
 * confounded, and no credential available here can pin the same checkpoint on
 * both paths — so the clean fix is unavailable and pretending otherwise would
 * be the category error this project exists to name.
 *
 * What IS available is measuring the confound instead of assuming it away.
 * Send the same deterministic prompts at temperature 0 to both endpoints and
 * compare outputs byte for byte.
 *
 * WHAT THIS CAN AND CANNOT SHOW — read before quoting any number it prints:
 *   - High divergence is evidence that the two endpoints differ in *something*
 *     (checkpoint, sampling implementation, quantisation, system prefix).
 *   - High agreement is NOT evidence they are the same checkpoint. Two builds
 *     of one model can agree on easy prompts and diverge elsewhere, and
 *     temperature 0 is not bit-determinism across different serving stacks.
 *   - Therefore this probe can only *strengthen* the confound, never dissolve
 *     it. A low divergence rate does not license calling the Slice 0.1 gap a
 *     gateway effect.
 */

const fs = require('fs');
const path = require('path');
const { resolve, chat } = require('./backends');

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '').trim();
    if (val === '') continue;
    const cur = process.env[m[1]];
    if (cur !== undefined && cur.trim() !== '') continue;
    process.env[m[1]] = val;
  }
}
loadEnv(path.join(__dirname, '.env'));

// Prompts chosen to be short, deterministic in intent, and varied in kind:
// arithmetic, format-following, list ordering, a refusal-free factual recall,
// and one that invites free-form phrasing where builds most easily diverge.
const PROMPTS = [
  'Compute 4813 * 27. Reply with the number only.',
  'Reply with exactly: OK-7391',
  'List the first six prime numbers, comma separated, no spaces, nothing else.',
  'Reply with the single word that completes: the capital of Japan is ____',
  'Write one sentence describing what a hash function does.',
  'Reply with exactly this JSON and nothing else: {"a":1,"b":[2,3]}',
  'Sort these words alphabetically, comma separated, no spaces: pear,apple,fig,date',
  'How many bytes are in a kibibyte? Reply with digits only.',
];

async function main() {
  const backends = resolve();
  const a = backends.find((b) => b.id === 'ds-direct');
  const b = backends.find((b) => b.id === 'ds-gateway');
  if (!a || !b || !a.available || !b.available) {
    console.error('both ds-direct and ds-gateway must be available');
    process.exit(2);
  }

  console.log(`\nA = ${a.id.padEnd(12)} ${a.model}`);
  console.log(`B = ${b.id.padEnd(12)} ${b.model}\n`);

  const rows = [];
  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];
    const msgs = [{ role: 'user', content: p }];
    const [ra, rb] = await Promise.all([
      chat(a, { messages: msgs, maxTokens: 256, timeoutMs: 120000 }),
      chat(b, { messages: msgs, maxTokens: 256, timeoutMs: 120000 }),
    ]);
    const text = (r) => {
      if (r.transport !== 'ok') return { err: r.transport };
      const m = r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].message;
      return { t: ((m && m.content) || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim() };
    };
    const ta = text(ra), tb = text(rb);
    const status = ta.err || tb.err ? 'ERROR' : ta.t === tb.t ? 'identical' : 'differs';
    rows.push({ i, prompt: p, a: ta, b: tb, status });
    console.log(`  ${String(i + 1).padStart(2)}. ${status.padEnd(10)} ${p.slice(0, 58)}`);
    if (status === 'differs') {
      console.log(`      A: ${JSON.stringify(ta.t).slice(0, 110)}`);
      console.log(`      B: ${JSON.stringify(tb.t).slice(0, 110)}`);
    }
  }

  const scored = rows.filter((r) => r.status !== 'ERROR');
  const same = scored.filter((r) => r.status === 'identical').length;
  console.log(`\n  byte-identical on ${same}/${scored.length} deterministic prompts` +
    (rows.length - scored.length ? `  (${rows.length - scored.length} ERROR, excluded)` : ''));
  console.log('\n  Reading this honestly:');
  console.log('    any divergence  -> the two endpoints differ in something, so the Slice 0.1');
  console.log('                       transport gap stays "serving path OR version"');
  console.log('    full agreement  -> still NOT proof of a shared checkpoint. This probe can');
  console.log('                       strengthen the confound; it cannot dissolve it.\n');

  const out = path.join(__dirname, 'runs', 'identity-probe.json');
  fs.writeFileSync(out, JSON.stringify({ a: { id: a.id, model: a.model }, b: { id: b.id, model: b.model }, rows }, null, 2));
  console.log(`  raw: ${out}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
