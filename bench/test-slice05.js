'use strict';

// Offline assertions for Slice 0.5. No network. Each block guards a line that
// could manufacture the result the slice is testing.

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { MUX_TOOLS, SPLIT_TOOLS, REQUIRES, interpret, execute, TASKS, LONG } = require('./slice05');
const { cellMeasures, fisherTwoSided, isK3Model } = require('./analyze05');

let n = 0;
const t = (name, fn) => { fn(); n++; };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tsb05t-'));

// --- 1. the omission must be detected identically in both arms ---------------
t('MUX create without file_text is an omission naming file_text', () => {
  const r = interpret('MUX', 'file_editor', { command: 'create', path: 'a.txt' });
  assert.deepStrictEqual(r.missing, ['file_text']);
  assert.strictEqual(r.error, 'Parameter `file_text` is required for command: create.');
  assert.strictEqual(r.commandAbsent, false);
});
t('SPLIT create_file without file_text is the same omission, same parameter named', () => {
  const r = interpret('SPLIT', 'create_file', { path: 'a.txt' });
  assert.deepStrictEqual(r.missing, ['file_text']);
  assert.strictEqual(r.error, 'Parameter `file_text` is required.');
});
t('the observed Kimi call shape: view_range on create is irrelevant, not an error', () => {
  const r = interpret('MUX', 'file_editor', { command: 'create', path: '/tmp/x.py', summary: 's', view_range: [0, 1] });
  assert.deepStrictEqual(r.missing, ['file_text']);
  assert.deepStrictEqual(r.irrelevant.sort(), ['summary', 'view_range']);
});
t('complete calls pass in both arms, and irrelevant args never cause rejection', () => {
  for (const [arm, name, args] of [
    ['MUX', 'file_editor', { command: 'create', path: 'a', file_text: 'x', view_range: [1, 2] }],
    ['SPLIT', 'create_file', { path: 'a', file_text: 'x', view_range: [1, 2] }],
    ['MUX', 'file_editor', { command: 'str_replace', path: 'a', old_str: 'x', new_str: 'y' }],
    ['SPLIT', 'replace_in_file', { path: 'a', old_str: 'x', new_str: 'y' }],
    ['MUX', 'file_editor', { command: 'insert', path: 'a', insert_line: 2, new_str: 'y' }],
    ['SPLIT', 'insert_in_file', { path: 'a', insert_line: 2, new_str: 'y' }],
    ['MUX', 'file_editor', { command: 'view', path: 'a' }],
    ['SPLIT', 'view_file', { path: 'a' }],
  ]) {
    const r = interpret(arm, name, args);
    assert.deepStrictEqual(r.missing, [], `${arm}/${name}`);
    assert.strictEqual(r.error, null, `${arm}/${name}`);
  }
});
t('null counts as missing; empty string is present (an empty file is legal)', () => {
  assert.deepStrictEqual(interpret('MUX', 'file_editor', { command: 'create', path: 'a', file_text: null }).missing, ['file_text']);
  assert.deepStrictEqual(interpret('SPLIT', 'create_file', { path: 'a', file_text: '' }).missing, []);
});
t('str_replace missing both strings reports both, in both arms', () => {
  assert.deepStrictEqual(interpret('MUX', 'file_editor', { command: 'str_replace', path: 'a' }).missing, ['old_str', 'new_str']);
  assert.deepStrictEqual(interpret('SPLIT', 'replace_in_file', { path: 'a' }).missing, ['old_str', 'new_str']);
});

// --- 2. command-absent is its own code, never a content omission -------------
t('MUX call with no command is commandAbsent with no missing content', () => {
  const r = interpret('MUX', 'file_editor', { path: 'a', file_text: 'x' });
  assert.strictEqual(r.commandAbsent, true);
  assert.deepStrictEqual(r.missing, []);
});
t('MUX unknown command is commandAbsent too', () => {
  assert.strictEqual(interpret('MUX', 'file_editor', { command: 'write', path: 'a' }).commandAbsent, true);
});
t('unknown tool names are unknownTool in both arms', () => {
  assert.strictEqual(interpret('MUX', 'create_file', { path: 'a' }).unknownTool, true);
  assert.strictEqual(interpret('SPLIT', 'file_editor', { command: 'view', path: 'a' }).unknownTool, true);
});

// --- 3. the two arms declare the same requirements ---------------------------
t('SPLIT schema required lists equal REQUIRES; MUX requires only command+path', () => {
  const op = { view_file: 'view', create_file: 'create', replace_in_file: 'str_replace', insert_in_file: 'insert' };
  for (const tl of SPLIT_TOOLS) assert.deepStrictEqual(tl.function.parameters.required, REQUIRES[op[tl.function.name]]);
  assert.deepStrictEqual(MUX_TOOLS[0].function.parameters.required, ['command', 'path']);
});
t('parameter names are identical across arms', () => {
  const mux = Object.keys(MUX_TOOLS[0].function.parameters.properties).filter((k) => k !== 'command').sort();
  const split = [...new Set(SPLIT_TOOLS.flatMap((tl) => Object.keys(tl.function.parameters.properties)))].sort();
  assert.deepStrictEqual(mux, split);
});

// --- 4. execution ------------------------------------------------------------
t('execute: create, replace (unique / absent / ambiguous), insert, view', () => {
  const d = tmp();
  execute(d, 'create', { path: 'f.txt', file_text: 'a\nb\nb\nd' });
  assert.match(execute(d, 'str_replace', { path: 'f.txt', old_str: 'zzz', new_str: 'y' }), /not found/);
  assert.match(execute(d, 'str_replace', { path: 'f.txt', old_str: 'b', new_str: 'y' }), /occurs 2 times/);
  execute(d, 'str_replace', { path: 'f.txt', old_str: 'a', new_str: '$&A' }); // no regex replacement semantics
  assert.strictEqual(fs.readFileSync(path.join(d, 'f.txt'), 'utf8'), '$&A\nb\nb\nd');
  execute(d, 'insert', { path: 'f.txt', insert_line: 1, new_str: 'X' });
  assert.strictEqual(fs.readFileSync(path.join(d, 'f.txt'), 'utf8'), '$&A\nX\nb\nb\nd');
  assert.match(execute(d, 'view', { path: 'f.txt', view_range: [2, 2] }), /^\s+2\tX$/);
  assert.match(execute(d, 'view', { path: 'nope.txt' }), /^Error/);
  assert.match(execute(d, 'create', { path: '../escape', file_text: 'x' }), /escapes/);
});

// --- 5. every task can pass and does not pass at setup -----------------------
const IDEAL = {
  L1: [['create', { path: 'notes.txt', file_text: 'OK-7391' }]],
  L2: [['create', { path: 'sales_report.py', file_text: LONG + '\n' }]],
  L3: [['str_replace', { path: 'config.ini', old_str: 'port = 8080', new_str: 'port = 9090' }]],
  L4: [['create', { path: 'todo.md', file_text: '- [ ] buy milk\n- [ ] call Sam\n- [ ] file taxes\n' }], ['str_replace', { path: 'todo.md', old_str: '- [ ] buy milk', new_str: '- [x] buy milk' }]],
  L5: [['insert', { path: 'steps.txt', insert_line: 2, new_str: 'charlie' }]],
  L6: [['view', { path: 'data.txt' }], ['create', { path: 'sum.txt', file_text: '49' }]],
};
for (const task of TASKS) {
  t(`${task.id}: fails at setup, passes after the ideal operations`, () => {
    const d = tmp();
    task.setup(d);
    assert.strictEqual(task.verify(d).ok, false);
    for (const [op, a] of IDEAL[task.id]) execute(d, op, a);
    assert.strictEqual(task.verify(d).ok, true, JSON.stringify(task.verify(d)));
  });
}
t('L2 baseline accepts the exact text and a fenced copy, rejects a one-character change', () => {
  const L2 = TASKS.find((x) => x.id === 'L2');
  assert.ok(L2.baselineVerify(LONG).ok);
  assert.ok(L2.baselineVerify('```python\n' + LONG + '\n```').ok);
  assert.ok(!L2.baselineVerify(LONG.replace('top=3', 'top=4')).ok);
});

// --- 6. the measures ---------------------------------------------------------
const C = (o) => ({ name: 'file_editor', args: {}, missing: [], irrelevant: [], commandAbsent: false, ...o });
t('cellMeasures: omissions, identical repeats, command-absent excluded, malformed excluded', () => {
  const om = C({ op: 'create', args: { command: 'create', path: 'a' }, missing: ['file_text'] });
  const rec = { calls: [
    { malformed: 'x' },
    om, { ...om }, { ...om },
    C({ op: 'create', args: { command: 'create', path: 'a', file_text: 'x' } }),
    C({ op: null, commandAbsent: true, args: { path: 'a' } }),
    C({ op: 'view', args: { command: 'view', path: 'a' } }),
  ] };
  const m = cellMeasures(rec);
  assert.strictEqual(m.contentCalls, 4);
  assert.strictEqual(m.omissions, 3);
  assert.strictEqual(m.createOmissions, 3);
  assert.strictEqual(m.repeatsAfterOmission, 2); // third omission is followed by a fixed call
  assert.strictEqual(m.omissionsFollowed, 3);
  assert.strictEqual(m.commandAbsent, 1);
  assert.strictEqual(m.malformed, 1);
});
t('a repeat differing only in call id is still identical', () => {
  const a = C({ id: 'c1', op: 'create', args: { command: 'create', path: 'a' }, missing: ['file_text'] });
  assert.strictEqual(cellMeasures({ calls: [a, { ...a, id: 'c2' }] }).repeatsAfterOmission, 1);
});
t('fisher exact: textbook values', () => {
  assert.ok(Math.abs(fisherTwoSided(3, 0, 0, 3) - 0.1) < 1e-9);
  assert.strictEqual(fisherTwoSided(0, 9, 0, 9), 1);
  assert.ok(Math.abs(fisherTwoSided(1, 9, 11, 3) - 0.002759) < 1e-5);
});

t('only a K3 model id counts as the predicted positive; K2.6 does not', () => {
  assert.strictEqual(isK3Model('moonshotai/Kimi-K2.6'), false);
  assert.strictEqual(isK3Model('moonshotai/kimi-k3'), true);
  assert.strictEqual(isK3Model('Kimi K3'), true);
  assert.strictEqual(isK3Model(undefined), false);
});

// --- 7. the K3 backend's documented differences, and only for K3 ------------
const { resolve, buildBody } = require('./backends');
const { assistantTurn } = require('./run05');
const BK = Object.fromEntries(resolve().map((b) => [b.id, b]));
t('K3 body: no temperature, reasoning_effort high, raised max_tokens', () => {
  const b = buildBody(BK['kimi-k3'], { messages: [], tools: [{}] });
  assert.ok(!('temperature' in b));
  assert.strictEqual(b.reasoning_effort, 'high');
  assert.strictEqual(b.max_tokens, 32768);
  assert.strictEqual(b.model, 'kimi-k3');
});
t('every other backend body is unchanged: temperature 0, max_tokens 4096, no extras', () => {
  for (const id of ['ds-direct', 'ds-gateway', 'glm-flash', 'minimax']) {
    const b = buildBody(BK[id], { messages: [], tools: [{}] });
    assert.strictEqual(b.temperature, 0, id);
    assert.strictEqual(b.max_tokens, 4096, id);
    assert.ok(!('reasoning_effort' in b), id);
  }
});
t('reasoning_content is sent back for K3 and stripped for the null-arm backends', () => {
  const msg = { role: 'assistant', content: '', reasoning_content: 'think', tool_calls: [{ id: 'x' }] };
  assert.strictEqual(assistantTurn(BK['kimi-k3'], msg, '').reasoning_content, 'think');
  const other = assistantTurn(BK['ds-direct'], msg, '');
  assert.ok(!('reasoning_content' in other));
  assert.deepStrictEqual(other.tool_calls, [{ id: 'x' }]);
});

console.log(`slice05: ${n} assertions passed`);
