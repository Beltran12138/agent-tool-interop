'use strict';

/**
 * Assertions for the outcome classifier.
 *
 * Two of these pin bugs the classifier actually had:
 *   - "every turn malformed" was reported as F0 (emitted nothing) instead of
 *     F2 (envelope present, never readable) — the exact distinction this bench
 *     is organised around, inverted inside the code that enforces it
 *   - a recovered argument violation shadowed the terminal failure, so a cell
 *     that stumbled, was told, fixed it, and then wrote a wrong value was
 *     reported as a schema violation
 */

const { classify } = require('./classify');

let pass = 0; const failures = [];
const base = { anyCall: false, anyMalformed: false, anyUnknownTool: false, anyArgViolation: false, calledExpected: false, calledOtherKnown: false, calledDistractor: false };
function eq(a, e, label) { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else failures.push(`${label}\n    expected ${JSON.stringify(e)}\n    actual   ${JSON.stringify(a)}`); }
function code(flags, verify, t) { return classify({ flags: { ...base, ...flags }, verify, transportOutcome: t || null }).outcome; }

eq(code({}, null, 'ERROR'), 'ERROR', 'transport failure stays ERROR');
eq(code({}, { ok: false, detail: 'x does not exist' }), 'F0', 'nothing tool-shaped at all is F0');
eq(code({ anyMalformed: true }, { ok: false, detail: 'x does not exist' }), 'F2',
   'envelope present every turn but never readable is F2, NOT F0');
eq(code({ anyCall: true, calledExpected: true }, { ok: true }), 'OK', 'verified side effect is OK');
eq(code({ anyCall: true, calledExpected: true, anyArgViolation: true }, { ok: false, detail: 'total.txt is "59"' }), 'F3',
   'recovered arg violation then wrong value is F3, not F2 — terminal state wins');
eq(classify({ flags: { ...base, anyCall: true, calledExpected: true, anyArgViolation: true }, verify: { ok: true } }).recovered, true,
   'recovery is recorded as a flag on an OK cell, not as a verdict');
eq(code({ anyCall: true, calledDistractor: true }, { ok: false, detail: 'report.txt does not exist' }), 'F1',
   'near-synonym distractor with a missing artifact is F1');
eq(code({ anyCall: true, calledExpected: true }, { ok: false, detail: 'report.txt does not exist' }), 'F4',
   'right tool, artifact absent, is F4');
eq(code({ anyCall: true, calledExpected: true }, { ok: false, detail: 'content is "wrong"' }), 'F3',
   'right tool, artifact present and wrong, is F3');
eq(code({ anyCall: true, anyArgViolation: true }, { ok: false, detail: 'x does not exist' }), 'F2',
   'arg violation that never recovered is F2');
eq(code({ anyArgViolation: true }, { ok: false, detail: 'x' }), 'F2',
   'and the same holds even if anyCall was never set (defensive)');
eq(code({ anyCall: true, anyUnknownTool: true }, { ok: false, detail: 'x does not exist' }), 'F1',
   'only ever called a nonexistent tool is F1');

/* -- strict mode (the Slice 0.2 dependent variable) ----------------------- */
// Under tolerance the harness silently absorbs syntax the prompt never
// specified, so a cell can read OK that a real scaffold would have rejected
// outright. Strict scoring moves conformance into the outcome. Both codes are
// always reported; neither alone is honest.
const okVariant = { ...base, anyCall: true, calledExpected: true, variantDialect: true };
eq(classify({ flags: okVariant, verify: { ok: true }, strict: true }).outcome, 'F2',
   'strict: a success reached via a non-specified dialect is F2');
eq(classify({ flags: okVariant, verify: { ok: true } }).outcome, 'OK',
   'tolerant: the same cell is OK');
eq(classify({ flags: okVariant, verify: { ok: true }, strict: true }).strictRejected, true,
   'strict rejection is flagged, not silent');
eq(classify({ flags: { ...base, anyCall: true, calledExpected: true }, verify: { ok: true }, strict: true }).outcome, 'OK',
   'strict does not penalise a cell that used the specified dialect');
eq(classify({ flags: okVariant, verify: null, transportOutcome: 'ERROR', strict: true }).outcome, 'ERROR',
   'strict never converts a transport failure into a model verdict');

console.log(`\nclassifier assertions: ${pass} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error('  FAIL ' + f); process.exit(1); }
console.log('all classifier assertions green\n');
