'use strict';

/**
 * Offline, deterministic parser assertions. No network, no model.
 *
 * This layer exists because the parser is the single place where a bug becomes
 * a fabricated finding: a parser that returns "no tool call" when it merely
 * failed to read one turns a measurement failure into a clean, quotable, false
 * result ("model X cannot drive form Y"). Every assertion below pins the
 * distinction between `none` (affirmative absence) and `malformed` (present but
 * unreadable).
 */

const { S1, S4, S5, stripReasoning } = require('./schemas');

let pass = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass++;
  else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}
function kind(res, expected, label) { eq(res.kind, expected, label); }

/* -- S1: native ----------------------------------------------------------- */
kind(S1.parse('', { content: 'I would write the file.' }), 'none', 'S1: no tool_calls field -> none');
kind(S1.parse('', { content: '', tool_calls: [] }), 'none', 'S1: empty tool_calls -> none');
kind(S1.parse('', { tool_calls: [{ id: 'a', function: { arguments: '{}' } }] }), 'malformed', 'S1: missing name -> malformed');
kind(S1.parse('', { tool_calls: [{ id: 'a', function: { name: 'write_file', arguments: '{oops' } }] }), 'malformed', 'S1: bad JSON args -> malformed');
kind(S1.parse('', { tool_calls: [{ id: 'a', function: { name: 'write_file', arguments: '["a"]' } }] }), 'malformed', 'S1: array args -> malformed');
{
  const r = S1.parse('', { tool_calls: [{ id: 'x1', function: { name: 'write_file', arguments: '{"path":"a.txt","content":"hi"}' } }] });
  eq([r.kind, r.name, r.args.path, r.args.content], ['call', 'write_file', 'a.txt', 'hi'], 'S1: good call parses');
}

/* -- S4: prompt XML ------------------------------------------------------- */
kind(S4.parse('Sure, I will do that.'), 'none', 'S4: prose only -> none');
kind(S4.parse('<tool_call>\n<function=write_file>'), 'malformed', 'S4: unclosed tool_call -> malformed');
kind(S4.parse('<tool_call>\nnothing useful\n</tool_call>'), 'malformed', 'S4: no function tag -> malformed');
{
  const r = S4.parse('ok\n<tool_call>\n<function=write_file>\n<parameter=path>report.txt</parameter>\n<parameter=content>OK-7391</parameter>\n</function>\n</tool_call>');
  eq([r.kind, r.name, r.args.path, r.args.content], ['call', 'write_file', 'report.txt', 'OK-7391'], 'S4: good call parses');
}
{
  // Multiline content must survive verbatim, including newlines.
  const r = S4.parse('<tool_call><function=write_file><parameter=content>a\nb</parameter></function></tool_call>');
  eq(r.args.content, 'a\nb', 'S4: multiline parameter preserved');
}

/* -- S5: prompt JSON ------------------------------------------------------ */
kind(S5.parse('I have finished the task.'), 'none', 'S5: prose only -> none');
kind(S5.parse('{"done": true}'), 'none', 'S5: done sentinel -> none (not malformed)');
kind(S5.parse('here is "tool": but no braces at all'), 'malformed', 'S5: marker without object -> malformed');
kind(S5.parse('{"tool": 5}'), 'malformed', 'S5: non-string tool -> malformed');
kind(S5.parse('{"tool": "write_file", "args": [1,2]}'), 'malformed', 'S5: array args -> malformed');
{
  const r = S5.parse('```json\n{"tool":"write_file","args":{"path":"a.txt","content":"hi"}}\n```');
  eq([r.kind, r.name, r.args.path], ['call', 'write_file', 'a.txt'], 'S5: fenced JSON parses');
}
{
  const r = S5.parse('Let me do that.\n{"tool":"read_file","args":{"path":"input.txt"}}');
  eq([r.kind, r.name, r.args.path], ['call', 'read_file', 'input.txt'], 'S5: prose then JSON parses');
}
{
  const r = S5.parse('{"tool":"list_dir"}');
  eq([r.kind, r.name, r.args], ['call', 'list_dir', {}], 'S5: missing args defaults to {} (schema check happens later)');
}

/* -- dialect tolerance ----------------------------------------------------- */
// Observed in a real run: MiniMax emitted <parameter name="path"> where the
// prompt specified <parameter=path>. A parser that accepts only the specified
// dialect reports F2 (schema violation) for a structurally valid call, which
// would turn a regex into the finding "prompt-embedded XML is brittle".
{
  const r = S4.parse('<tool_call>\n<function=append_file>\n<parameter name="path">log.txt</parameter>\n<parameter name="content">\nDONE</parameter>\n</function>\n</tool_call>');
  eq([r.kind, r.name, r.args.path, r.args.content, r.dialect], ['call', 'append_file', 'log.txt', '\nDONE', 'variant'], 'S4: attribute dialect parses AND is flagged variant');
}
{
  const r = S4.parse('<tool_call><function name="write_file"><parameter name="path">a</parameter></function></tool_call>');
  eq([r.kind, r.name, r.dialect], ['call', 'write_file', 'variant'], 'S4: attribute function dialect parses as variant');
}
{
  const r = S4.parse('<tool_call><function=write_file><parameter=path>a</parameter></function></tool_call>');
  eq(r.dialect, 'specified', 'S4: specified dialect is not flagged variant');
}
{
  const r = S5.parse('{"name":"write_file","arguments":{"path":"a.txt"}}');
  eq([r.kind, r.name, r.args.path, r.dialect], ['call', 'write_file', 'a.txt', 'variant'], 'S5: name/arguments dialect parses as variant');
}
{
  const r = S5.parse('{"tool":"write_file","args":{"path":"a.txt"}}');
  eq(r.dialect, 'specified', 'S5: specified dialect is not flagged variant');
}
{
  // The marker must be at least as wide as the parser, or a variant-dialect
  // call becomes a false `none` — a fabricated "emitted nothing".
  eq(S5.parse('{"name":"write_file","arguments":{}}').kind, 'call', 'S5: marker covers variant dialect (no false none)');
}
eq(S5.parse('{"done": true}').kind, 'none', 'S5: done sentinel still none after widening the marker');

/* -- reasoning stripping -------------------------------------------------- */
{
  const r = stripReasoning('<think>hmm let me consider</think>\n{"tool":"x"}');
  eq([r.stripped, r.text], [true, '{"tool":"x"}'], 'strip: closed think block removed');
}
{
  const r = stripReasoning('plain text');
  eq([r.stripped, r.unclosed], [false, false], 'strip: untouched text reports no stripping');
}
{
  const r = stripReasoning('<think>cut off mid thou');
  eq(r.unclosed, true, 'strip: unclosed think flagged as truncation, not as absence');
}
{
  // The critical one: a reasoning preamble must not make a real call invisible.
  const r = stripReasoning('<think>I should write the file</think>\n<tool_call><function=write_file></function></tool_call>');
  eq(S4.parse(r.text).kind, 'call', 'strip+parse: call survives a reasoning preamble');
}
{
  // And its mirror: reasoning that MENTIONS a call but emits none is still none.
  const r = stripReasoning('<think>I could use <tool_call> here</think>\nI will explain instead.');
  eq(S4.parse(r.text).kind, 'none', 'strip+parse: a call mentioned only inside reasoning is not a call');
}

/* ------------------------------------------------------------------------- */
console.log(`\nparser assertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log('all parser assertions green\n');
