'use strict';

// Offline assertions for Slice 0.6. No network.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const S06 = require('./slice06');
const { interpretCall, executeCall } = require('./run06');
const { cellMeasures } = require('./analyze06');
const { SYSTEM: BASE_SYSTEM } = require('./run05');

let n = 0;
const t = (name, fn) => { fn(); n++; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsb06t-'));
const props = (tool) => Object.keys(tool.function.parameters.properties);
const byName = (tools, nm) => tools.find((x) => x.function.name === nm);

// --- 1. the reconstructed OpenHands surface ----------------------------------
t('five OpenHands tools, in the SDK order', () => {
  assert.deepStrictEqual(S06.OH_TOOLS.map((x) => x.function.name), ['terminal', 'file_editor', 'task_tracker', 'finish', 'think']);
});
t('file_editor leads with the injected meta fields, and file_text is a plain string', () => {
  const fe = byName(S06.OH_TOOLS, 'file_editor');
  assert.deepStrictEqual(props(fe).slice(0, 4), ['security_risk', 'summary', 'command', 'path']);
  assert.deepStrictEqual(fe.function.parameters.properties.file_text, { type: 'string', description: 'Required parameter of `create` command, with the content of the file to be created.' });
  assert.deepStrictEqual(fe.function.parameters.required, ['command', 'path']);
});
t('no Windows path or scratch directory leaked into the assets', () => {
  // A drive letter must be followed by a path character: the first version of
  // this check matched "TOOL:\n" in the JSON (an escaped newline) and failed on
  // clean assets. In JSON a real Windows path is serialized as `C:\\Users`.
  const json = JSON.stringify(S06.OH_TOOLS);
  assert.ok(!/[A-Z]:\\\\[A-Za-z]/.test(json) && !/[A-Z]:\\[A-Za-z]/.test(S06.OH_SYSTEM_BODY), 'Windows path leak');
  assert.ok(!/wsdir|AppData|powershell/i.test(json + S06.OH_SYSTEM_BODY), 'scratch/platform leak');
  assert.ok(/[A-Z]:\\\\[A-Za-z]/.test(JSON.stringify(['C:\\Users\\x'])), 'the check itself can fire');
  assert.ok(/Your current working directory is: \/workspace/.test(JSON.stringify(S06.OH_TOOLS)));
});
t('system prompt is OpenHands and ends with a datetime block', () => {
  const s = S06.ohSystem(new Date('2026-10-04T07:00:00Z'));
  assert.ok(s.startsWith('<SOUL>\nYou are OpenHands agent'));
  assert.ok(s.endsWith('<CURRENT_DATETIME>\nThe current date and time is: 2026-10-04T07:00\n</CURRENT_DATETIME>'));
});

// --- 2. each ablation removes exactly one thing -------------------------------
t('A-meta strips security_risk and summary from every tool and nothing else', () => {
  const oh = S06.surface('OH', BASE_SYSTEM), am = S06.surface('A-meta', BASE_SYSTEM);
  am.tools.forEach((tl, i) => {
    assert.ok(!props(tl).includes('summary') && !props(tl).includes('security_risk'));
    assert.deepStrictEqual(props(tl), props(oh.tools[i]).filter((k) => !S06.META.includes(k)));
    assert.strictEqual(tl.function.description, oh.tools[i].function.description);
  });
  assert.strictEqual(am.system.split('<CURRENT_DATETIME>')[0], oh.system.split('<CURRENT_DATETIME>')[0]);
  assert.deepStrictEqual(byName(S06.OH_TOOLS, 'finish').function.parameters.required, ['message']);
});
t('A-desc changes only file_editor.description', () => {
  const oh = S06.surface('OH', BASE_SYSTEM), ad = S06.surface('A-desc', BASE_SYSTEM);
  ad.tools.forEach((tl, i) => {
    assert.deepStrictEqual(tl.function.parameters, oh.tools[i].function.parameters);
    if (tl.function.name !== 'file_editor') assert.strictEqual(tl.function.description, oh.tools[i].function.description);
  });
  assert.notStrictEqual(byName(ad.tools, 'file_editor').function.description, byName(oh.tools, 'file_editor').function.description);
});
t('A-sys changes only the system prompt; A-solo keeps only file_editor; BASE is Slice 0.5 MUX', () => {
  const oh = S06.surface('OH', BASE_SYSTEM);
  assert.strictEqual(S06.surface('A-sys', BASE_SYSTEM).system, BASE_SYSTEM);
  assert.deepStrictEqual(S06.surface('A-sys', BASE_SYSTEM).tools, oh.tools);
  assert.deepStrictEqual(S06.surface('A-solo', BASE_SYSTEM).tools, [byName(oh.tools, 'file_editor')]);
  assert.deepStrictEqual(S06.surface('BASE', BASE_SYSTEM).tools, require('./slice05').MUX_TOOLS);
});
t('surfaces do not share mutable state with the assets', () => {
  const a = S06.surface('OH', BASE_SYSTEM);
  a.tools[0].function.description = 'mutated';
  assert.notStrictEqual(S06.OH_TOOLS[0].function.description, 'mutated');
});

// --- 3. the measure ---------------------------------------------------------
t('the observed Kimi shape is an omission and its summary is recorded', () => {
  const it = interpretCall('OH', 'file_editor', { command: 'create', path: '/tmp/x.py', summary: 's', view_range: [0, 1] });
  assert.deepStrictEqual(it.missing, ['file_text']);
  assert.deepStrictEqual(it.meta, ['summary']);
  assert.strictEqual(it.error, 'Parameter `file_text` is required for command: create.');
});
t('BASE detects the same omission with the same message', () => {
  const it = interpretCall('BASE', 'file_editor', { command: 'create', path: '/workspace/a' });
  assert.deepStrictEqual(it.missing, ['file_text']);
  assert.strictEqual(it.error, 'Parameter `file_text` is required for command: create.');
});
t('OpenHands str_replace without new_str is legal (OpenHands semantics)', () => {
  assert.deepStrictEqual(interpretCall('OH', 'file_editor', { command: 'str_replace', path: '/workspace/a', old_str: 'x' }).missing, []);
});
t('cellMeasures: first create, cells without a create, meta counts, repeats', () => {
  const om = { name: 'file_editor', op: 'create', args: { command: 'create', path: '/workspace/a', summary: 's' }, missing: ['file_text'], meta: ['summary'] };
  const m = cellMeasures({ calls: [{ name: 'terminal', op: null, args: { command: 'ls' }, missing: [], meta: [] }, om, { ...om }, { ...om, args: { ...om.args, file_text: 'x' }, missing: [] }] });
  assert.strictEqual(m.firstCreateOmits, true);
  assert.strictEqual(m.creates, 3);
  assert.strictEqual(m.createOmissions, 2);
  assert.strictEqual(m.feWithSummary, 3);
  assert.strictEqual(m.terminalBeforeCreate, 1);
  assert.strictEqual(m.repeats, 1);
  const none = cellMeasures({ calls: [{ name: 'terminal', op: null, args: {}, missing: [], meta: [] }] });
  assert.strictEqual(none.hasCreate, false);
  assert.strictEqual(none.firstCreateOmits, null); // never a non-omission
});

// --- 4. execution: paths, create semantics, terminal never executes ---------
t('paths: /workspace maps into the sandbox, other absolute paths are refused', () => {
  assert.strictEqual(S06.mapPath('/workspace/a.txt'), 'a.txt');
  assert.strictEqual(S06.mapPath('/workspace'), '.');
  assert.strictEqual(S06.mapPath('a.txt'), 'a.txt');
  assert.strictEqual(S06.mapPath('/tmp/a.txt'), null);
});
t('OH create writes, then refuses to overwrite; BASE create works with /workspace paths', () => {
  const d = tmp();
  assert.match(S06.execOH(d, 'file_editor', { command: 'create', path: '/workspace/a.txt', file_text: 'hi' }), /created/);
  assert.match(S06.execOH(d, 'file_editor', { command: 'create', path: '/workspace/a.txt', file_text: 'x' }), /already exists/);
  assert.strictEqual(fs.readFileSync(path.join(d, 'a.txt'), 'utf8'), 'hi');
  const d2 = tmp();
  const it = interpretCall('BASE', 'file_editor', { command: 'create', path: '/workspace/b.txt', file_text: 'yo' });
  executeCall('BASE', d2, 'file_editor', { command: 'create', path: '/workspace/b.txt', file_text: 'yo' }, it);
  assert.strictEqual(fs.readFileSync(path.join(d2, 'b.txt'), 'utf8'), 'yo');
});
t('terminal emulates read-only commands and executes nothing else', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'f.txt'), 'a\nb\n');
  assert.strictEqual(S06.execTerminal(d, { command: 'cat /workspace/f.txt' }), 'a\nb\n');
  assert.strictEqual(S06.execTerminal(d, { command: 'ls' }), 'f.txt');
  assert.strictEqual(S06.execTerminal(d, { command: 'pwd' }), '/workspace');
  for (const bad of ['rm -rf /workspace', 'cat > x.py <<EOF\nprint(1)\nEOF', 'ls; rm f.txt', 'python3 -c "print(1)"', 'echo hi > g.txt', 'cat ../../etc/passwd']) {
    const r = S06.execTerminal(d, { command: bad });
    assert.ok(r === S06.TERMINAL_UNAVAILABLE || /No such file|cannot access/.test(r), bad);
  }
  assert.deepStrictEqual(fs.readdirSync(d), ['f.txt']);
});
t('every task fails at setup', () => {
  for (const task of S06.TASKS) { const d = tmp(); task.setup(d); assert.strictEqual(task.verify(d).ok, false, task.id); }
});

console.log(`slice06: ${n} assertions passed`);
