'use strict';

// Offline assertions for Slice 0.8. No network, no dataset needed.
const assert = require('assert');
const { prefixOf, toApi, classifyReply, sample, chars } = require('./replay08');
const { decide } = require('./analyze08');

let n = 0;
const t = (name, fn) => { fn(); n++; };
const call = (name, args, id = 'c') => ({ id, name, arguments: JSON.stringify(args) });

t('prefix stops before the first create and records the original outcome', () => {
  const run = { messages: [
    { role: 'system', content: 's' }, { role: 'user', content: 'u' },
    { role: 'assistant', content: '', tool_calls: [call('terminal', { command: 'ls' })] }, { role: 'tool', tool_call_id: 'c', content: 'a' },
    { role: 'assistant', content: '', tool_calls: [call('file_editor', { command: 'create', path: '/x', summary: 's' })] },
    { role: 'assistant', content: '', tool_calls: [call('file_editor', { command: 'create', path: '/x', file_text: 'y' })] },
  ] };
  const p = prefixOf(run);
  assert.strictEqual(p.at, 4);
  assert.strictEqual(p.prefix.length, 4);
  assert.strictEqual(p.original, 'omit');
});
t('a view is not a create; a run without create has no prefix', () => {
  assert.strictEqual(prefixOf({ messages: [{ role: 'assistant', tool_calls: [call('file_editor', { command: 'view', path: '/x' })] }] }), null);
});
t('toApi: tool_calls to API shape, logging fields dropped, fallback adds empty reasoning', () => {
  const m = { role: 'assistant', content: null, reasoning: '', timestamp: 't', name: null, tool_calls: [call('terminal', { command: 'ls' }, 'id1')] };
  assert.deepStrictEqual(toApi(m), { role: 'assistant', content: '', tool_calls: [{ id: 'id1', type: 'function', function: { name: 'terminal', arguments: '{"command":"ls"}' } }] });
  assert.strictEqual(toApi(m, { emptyReasoning: true }).reasoning_content, '');
  assert.deepStrictEqual(toApi({ role: 'tool', tool_call_id: 'id1', content: 'x', timestamp: 't' }), { role: 'tool', tool_call_id: 'id1', content: 'x' });
});
const reply = (...calls) => ({ tool_calls: calls.map((c) => ({ id: 'r', type: 'function', function: { name: c.name, arguments: c.arguments } })) });
t('classifyReply: omission, ok, other tool, text; the create wins over an earlier other call', () => {
  assert.strictEqual(classifyReply(reply(call('file_editor', { command: 'create', path: '/a', summary: 's' }))).cls, 'create-omit');
  assert.strictEqual(classifyReply(reply(call('file_editor', { command: 'create', path: '/a', file_text: '' }))).cls, 'create-ok');
  assert.strictEqual(classifyReply(reply(call('terminal', { command: 'ls' }), call('file_editor', { command: 'create', path: '/a' }))).cls, 'create-omit');
  assert.strictEqual(classifyReply(reply(call('terminal', { command: 'ls' }))).cls, 'other-tool');
  assert.strictEqual(classifyReply({ content: 'done' }).cls, 'text');
  assert.strictEqual(classifyReply(reply({ name: 'terminal', arguments: '{bad' })).cls, 'other-tool');
});
t('sampling is seed-fixed and follows the plan', () => {
  const pool = [];
  for (const bench of ['terminal-bench-4', 'tua-bench']) for (let i = 0; i < 30; i++) pool.push({ bench, task: `t${i}`, original: i < 22 ? 'omit' : 'ok' });
  const a = sample(pool), b = sample([...pool].reverse());
  assert.deepStrictEqual(a.map((x) => x.bench + x.task), b.map((x) => x.bench + x.task), 'independent of input order');
  assert.strictEqual(a.filter((x) => x.original === 'omit').length, 20);
  assert.strictEqual(a.filter((x) => x.original === 'ok').length, 6);
  assert.strictEqual(a.filter((x) => x.original === 'omit' && x.bench === 'tua-bench').length, 10);
});
t('chars counts content and tool_calls', () => {
  assert.strictEqual(chars([{ content: 'abc' }, { content: null, tool_calls: [{ a: 1 }] }]), 3 + JSON.stringify([{ a: 1 }]).length);
});
t('decide: thresholds and the minimum of 8 create replies; ERROR and non-create rows excluded', () => {
  const R = (cls, original = 'omit') => ({ cls, original });
  assert.match(decide([...Array(5)].map(() => R('create-omit'))).verdict, /INCONCLUSIVE \(fewer/);
  assert.strictEqual(decide([...Array(6)].map(() => R('create-omit')).concat([...Array(4)].map(() => R('create-ok')))).verdict, 'CONTENT REPRODUCES IT');
  assert.strictEqual(decide([...Array(10)].map(() => R('create-ok')).concat([R('ERROR'), R('other-tool'), R('create-omit', 'ok')])).verdict, 'CONTENT DOES NOT REPRODUCE IT');
  assert.match(decide([...Array(3)].map(() => R('create-omit')).concat([...Array(7)].map(() => R('create-ok')))).verdict, /between/);
});

console.log(`slice08: ${n} assertions passed`);
