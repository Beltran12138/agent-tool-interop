'use strict';

/**
 * Offline assertions for type validation and coercion. No network, no model.
 *
 * This is the Slice 0.1 equivalent of the parser tests, and it exists for the
 * same reason. The structured-argument probe only means anything if
 * "the form could not express this" is kept distinct from "the model got it
 * wrong". Coercion is the seam where those two collapse into each other:
 *   - coerce too eagerly and a prompt-embedded form looks as expressive as a
 *     native schema, erasing the effect being measured
 *   - refuse to coerce and a model that correctly JSON-encoded a value into a
 *     text-only envelope is scored as a schema violation
 * Every assertion below pins one side of that seam.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateArgs, execute, TASKS, TRICKY } = require('./tasks');

let pass = 0;
const failures = [];
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
}

const NATIVE = {
  path: 'record.json',
  title: 'Quarterly Review',
  tags: ['finance', 'q3', 'urgent'],
  priority: 'high',
  retries: 4,
  owner: { name: 'Dana Wu', email: 'dana@example.com' },
};

/* -- native types (what S1 and S5 can send) -------------------------------- */
{
  const v = validateArgs('create_record', NATIVE);
  eq([v.ok, v.coercions], [true, []], 'native structured args validate with NO coercion');
}

/* -- text-only envelope (what S4 must send) -------------------------------- */
{
  const v = validateArgs('create_record', {
    path: 'record.json',
    title: 'Quarterly Review',
    tags: '["finance","q3","urgent"]',
    priority: 'high',
    retries: '4',
    owner: '{"name":"Dana Wu","email":"dana@example.com"}',
  });
  eq(v.ok, true, 'JSON-encoded args from a text-only envelope validate');
  eq(v.coercions.sort(), ['owner:string->object', 'retries:string->integer', 'tags:string->array'], 'coercions are recorded, not hidden');
  eq(v.coerced.tags, ['finance', 'q3', 'urgent'], 'coerced array has the right value');
  eq(v.coerced.retries, 4, 'coerced integer is a number');
  eq(v.coerced.owner.email, 'dana@example.com', 'coerced object keeps nested values');
}

/* -- the seam: coercion must not rescue genuinely wrong values ------------- */
eq(validateArgs('create_record', { ...NATIVE, priority: 'urgent' }).ok, false, 'enum outside the declared set is rejected');
eq(validateArgs('create_record', { ...NATIVE, priority: 'High' }).ok, false, 'enum is case-sensitive, not silently normalised');
eq(validateArgs('create_record', { ...NATIVE, retries: '4.5' }).ok, false, 'non-integer numeric string is rejected');
eq(validateArgs('create_record', { ...NATIVE, retries: 'four' }).ok, false, 'spelled-out number is rejected');
eq(validateArgs('create_record', { ...NATIVE, tags: '[finance, q3]' }).ok, false, 'invalid JSON for an array is rejected');
eq(validateArgs('create_record', { ...NATIVE, tags: '"finance"' }).ok, false, 'JSON string where an array is required is rejected');
eq(validateArgs('create_record', { ...NATIVE, owner: '{"name":"Dana Wu"}' }).ok, false, 'object missing a declared key is rejected');
eq(validateArgs('create_record', { path: 'r.json', title: 't', tags: [], priority: 'low' }).ok, false, 'missing required parameter is rejected');
eq(validateArgs('create_record', { ...NATIVE, extra: 'x' }).ok, false, 'undeclared parameter is rejected');
eq(validateArgs('write_file', { path: 'a', content: 5 }).ok, false, 'number where a string is declared is rejected');

/* -- distractors ----------------------------------------------------------- */
{
  const v = validateArgs('save_file', { path: 'report.txt', content: 'OK-7391' });
  eq([v.ok, v.isDistractor], [true, true], 'a near-synonym distractor validates and is flagged as one');
}
eq(validateArgs('no_such_tool', {}).unknownTool, true, 'unknown tool is reported as unknown, not as a schema violation');

/* -- execution + verification round-trip ----------------------------------- */
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tsbench-test-')); }

{
  const dir = tmp();
  const v = validateArgs('create_record', NATIVE);
  execute(dir, 'create_record', v.coerced);
  eq(TASKS.find((t) => t.id === 'T4').verify(dir).ok, true, 'T4 verify passes on a correct record');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // Order matters in the tags array; a verifier that accepted any order would
  // be measuring something looser than the task states.
  const dir = tmp();
  const v = validateArgs('create_record', { ...NATIVE, tags: ['q3', 'finance', 'urgent'] });
  execute(dir, 'create_record', v.coerced);
  eq(TASKS.find((t) => t.id === 'T4').verify(dir).ok, false, 'T4 verify rejects a reordered tags array');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // The escaping probe must round-trip byte for byte.
  const dir = tmp();
  execute(dir, 'write_file', { path: 'payload.txt', content: TRICKY });
  eq(TASKS.find((t) => t.id === 'T6').verify(dir).ok, true, 'T6 verify passes on exact tricky content');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const dir = tmp();
  execute(dir, 'write_file', { path: 'payload.txt', content: TRICKY.replace('\\', '') });
  eq(TASKS.find((t) => t.id === 'T6').verify(dir).ok, false, 'T6 verify rejects a dropped backslash');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // A distractor writes somewhere no verifier looks: the task must fail, and it
  // must fail silently from the model's point of view.
  const dir = tmp();
  const r = execute(dir, 'save_file', { path: 'report.txt', content: 'OK-7391' });
  eq(r.ok, true, 'distractor reports success to the model');
  eq(TASKS.find((t) => t.id === 'T1').verify(dir).ok, false, 'but the task verifier still fails');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  // list_dir must not reveal the archive directory the distractors write into,
  // or the model could notice the trap through the tool surface.
  const dir = tmp();
  execute(dir, 'save_file', { path: 'x.txt', content: 'y' });
  execute(dir, 'write_file', { path: 'real.txt', content: 'z' });
  eq(execute(dir, 'list_dir', { path: '.' }).result, 'real.txt', 'list_dir hides the distractor archive');
  fs.rmSync(dir, { recursive: true, force: true });
}

/* -------------------------------------------------------------------------- */
console.log(`\nvalidation assertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
console.log('all validation assertions green\n');
