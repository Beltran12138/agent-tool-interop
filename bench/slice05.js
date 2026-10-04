'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Slice 0.5 — multiplexed vs split tools. See BENCH-DESIGN.md, pre-registration
 * of 2026-10-04, which was committed before this file existed.
 *
 * The variable is the tool DECOMPOSITION, not the envelope: both arms are sent
 * as native S1 function tools. Parameter names are identical across arms, so
 * the only differences are (a) one tool selecting its operation by `command`
 * versus one tool per operation, and (b) the requirement for content stated in
 * a description versus in the JSON Schema `required` list. Those two cannot be
 * separated with plain JSON Schema and are reported as one construct.
 *
 * Irrelevant or undeclared arguments are IGNORED AND RECORDED in both arms.
 * Rejecting them in one arm and not the other would give that arm a failure
 * rule the other does not have.
 */

// Which arguments each operation needs. Single source for validation in both
// arms and for the omission measure, so the two cannot drift apart.
const REQUIRES = {
  view: ['path'],
  create: ['path', 'file_text'],
  str_replace: ['path', 'old_str', 'new_str'],
  insert: ['path', 'insert_line', 'new_str'],
};
const CONTENT_OPS = new Set(['create', 'str_replace', 'insert']);
const ALL_PARAMS = ['path', 'file_text', 'old_str', 'new_str', 'insert_line', 'view_range'];

const P = {
  path: { type: 'string', description: 'File path relative to the working directory.' },
  file_text: { type: 'string', description: 'The full content of the file.' },
  old_str: { type: 'string', description: 'The exact text to replace. Must occur exactly once in the file.' },
  new_str: { type: 'string', description: 'The new text.' },
  insert_line: { type: 'integer', description: 'Line number after which new_str is inserted (0 inserts at the top).' },
  view_range: { type: 'array', items: { type: 'integer' }, description: 'Optional [start, end] line range, 1-indexed, inclusive.' },
};

const MUX_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'file_editor',
      description:
        'View, create and edit files. Select the operation with `command`:\n' +
        '- `view`: show the file with line numbers\n' +
        '- `create`: create or overwrite a file with `file_text`\n' +
        '- `str_replace`: replace `old_str` with `new_str`; `old_str` must occur exactly once\n' +
        '- `insert`: insert `new_str` after line `insert_line`',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', enum: ['view', 'create', 'str_replace', 'insert'], description: 'The operation to run.' },
          path: P.path,
          file_text: { ...P.file_text, description: 'Required for `create`: the full content of the file.' },
          old_str: { ...P.old_str, description: 'Required for `str_replace`: the exact text to replace. Must occur exactly once.' },
          new_str: { ...P.new_str, description: 'Required for `str_replace` (the replacement text) and for `insert` (the text to insert).' },
          insert_line: { ...P.insert_line, description: 'Required for `insert`: the line number after which `new_str` is inserted (0 inserts at the top).' },
          view_range: { ...P.view_range, description: 'Optional for `view`: [start, end] line range, 1-indexed, inclusive.' },
        },
        required: ['command', 'path'],
      },
    },
  },
];

const SPLIT_DEF = [
  { name: 'view_file', op: 'view', description: 'Show a file with line numbers.', params: ['path', 'view_range'] },
  { name: 'create_file', op: 'create', description: 'Create or overwrite a file with the given content.', params: ['path', 'file_text'] },
  { name: 'replace_in_file', op: 'str_replace', description: 'Replace old_str with new_str in a file. old_str must occur exactly once.', params: ['path', 'old_str', 'new_str'] },
  { name: 'insert_in_file', op: 'insert', description: 'Insert new_str after line insert_line of a file.', params: ['path', 'insert_line', 'new_str'] },
];
const SPLIT_TOOLS = SPLIT_DEF.map((t) => ({
  type: 'function',
  function: {
    name: t.name,
    description: t.description,
    parameters: {
      type: 'object',
      properties: Object.fromEntries(t.params.map((p) => [p, P[p]])),
      required: REQUIRES[t.op],
    },
  },
}));
const SPLIT_OP = Object.fromEntries(SPLIT_DEF.map((t) => [t.name, t]));

const ARMS = {
  MUX: { id: 'MUX', tools: MUX_TOOLS },
  SPLIT: { id: 'SPLIT', tools: SPLIT_TOOLS },
};

/**
 * Read one call into an operation plus a verdict. Never throws.
 *
 * Returns { op, missing, irrelevant, error, unknownTool, commandAbsent }.
 *   op            the operation selected, or null
 *   missing       required arguments that are absent or null
 *   irrelevant    arguments present but not used by the selected operation
 *   commandAbsent MUX call with no readable `command` — its own code, never an
 *                 omission of content (merging them would repeat F0/F2 here)
 *   error         the exact message returned to the model, or null
 */
function interpret(arm, name, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const present = (k) => k in a && a[k] !== null && a[k] !== undefined;
  let op = null;
  if (arm === 'MUX') {
    if (name !== 'file_editor') return { op: null, unknownTool: true, missing: [], irrelevant: [], error: `No such tool: ${name}` };
    if (!present('command')) return { op: null, commandAbsent: true, missing: [], irrelevant: [], error: 'Parameter `command` is required.' };
    if (!REQUIRES[a.command]) return { op: null, commandAbsent: true, missing: [], irrelevant: [], error: `Unknown command: ${JSON.stringify(a.command).slice(0, 40)}. Allowed: view, create, str_replace, insert.` };
    op = a.command;
  } else {
    const def = SPLIT_OP[name];
    if (!def) return { op: null, unknownTool: true, missing: [], irrelevant: [], error: `No such tool: ${name}` };
    op = def.op;
  }
  const needed = REQUIRES[op];
  const missing = needed.filter((k) => !present(k));
  const used = new Set([...needed, ...(op === 'view' ? ['view_range'] : [])]);
  const irrelevant = Object.keys(a).filter((k) => k !== 'command' && !used.has(k));
  let error = null;
  if (missing.length) {
    error = arm === 'MUX'
      ? `Parameter \`${missing[0]}\` is required for command: ${op}.`
      : `Parameter \`${missing[0]}\` is required.`;
  }
  return { op, missing, irrelevant, error, unknownTool: false, commandAbsent: false };
}

function safeJoin(dir, p) {
  if (typeof p !== 'string' || p === '') throw new Error('path must be a non-empty string');
  const resolved = path.resolve(dir, p);
  if (!resolved.startsWith(path.resolve(dir))) throw new Error('path escapes the sandbox');
  return resolved;
}

/** Execute an operation whose required arguments are all present. */
function execute(dir, op, a) {
  try {
    const f = safeJoin(dir, a.path);
    switch (op) {
      case 'view': {
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        let [s, e] = Array.isArray(a.view_range) && a.view_range.length === 2 ? a.view_range : [1, lines.length];
        if (e === -1) e = lines.length;
        return lines.slice(Math.max(0, s - 1), e).map((l, i) => `${String(i + Math.max(1, s)).padStart(6)}\t${l}`).join('\n');
      }
      case 'create':
        if (typeof a.file_text !== 'string') return 'Error: `file_text` must be a string.';
        fs.writeFileSync(f, a.file_text, 'utf8');
        return `File created successfully at: ${a.path}`;
      case 'str_replace': {
        if (!fs.existsSync(f)) return `Error: ${a.path} does not exist.`;
        const src = fs.readFileSync(f, 'utf8');
        const n = src.split(String(a.old_str)).length - 1;
        if (n === 0) return `Error: old_str was not found in ${a.path}.`;
        if (n > 1) return `Error: old_str occurs ${n} times in ${a.path}; it must be unique.`;
        fs.writeFileSync(f, src.replace(String(a.old_str), () => String(a.new_str)), 'utf8');
        return `The file ${a.path} has been edited.`;
      }
      case 'insert': {
        if (!fs.existsSync(f)) return `Error: ${a.path} does not exist.`;
        const k = typeof a.insert_line === 'string' && /^\d+$/.test(a.insert_line) ? parseInt(a.insert_line, 10) : a.insert_line;
        if (!Number.isInteger(k)) return 'Error: `insert_line` must be an integer.';
        const lines = fs.readFileSync(f, 'utf8').split('\n');
        if (k < 0 || k > lines.length) return `Error: insert_line ${k} is outside 0..${lines.length}.`;
        lines.splice(k, 0, ...String(a.new_str).split('\n'));
        fs.writeFileSync(f, lines.join('\n'), 'utf8');
        return `The file ${a.path} has been edited.`;
      }
      default:
        return `Error: unknown operation ${op}`;
    }
  } catch (e) {
    return `Error: ${String(e.message)}`;
  }
}

// --- tasks ------------------------------------------------------------------
function read(dir, n) {
  const f = path.join(dir, n);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}
const norm = (s) => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();

const LONG = [
  'import csv',
  'import sys',
  'from collections import defaultdict',
  '',
  '',
  'def load(path):',
  '    totals = defaultdict(float)',
  '    with open(path, newline="") as fh:',
  '        for row in csv.DictReader(fh):',
  '            region = row["region"].strip().lower()',
  '            try:',
  '                totals[region] += float(row["amount"])',
  '            except (KeyError, ValueError):',
  '                print(f"skipping bad row: {row!r}", file=sys.stderr)',
  '    return totals',
  '',
  '',
  'def report(totals, top=3):',
  '    ranked = sorted(totals.items(), key=lambda kv: kv[1], reverse=True)',
  '    for i, (region, amount) in enumerate(ranked[:top], start=1):',
  '        print(f"{i}. {region:<12} {amount:>10.2f}")',
  '    return ranked',
  '',
  '',
  'if __name__ == "__main__":',
  '    report(load(sys.argv[1]))',
].join('\n');

const TASKS = [
  {
    id: 'L1', label: 'create, short content',
    setup() {},
    prompt: 'Create a file named notes.txt whose entire content is exactly: OK-7391',
    verify(d) { const g = read(d, 'notes.txt'); return g === null ? { ok: false, detail: 'notes.txt does not exist' } : g.trim() === 'OK-7391' ? { ok: true } : { ok: false, detail: `content ${JSON.stringify(g.slice(0, 60))}` }; },
    baselineQuestion: 'Reply with exactly this token and nothing else: OK-7391',
    baselineVerify(t) { return t.includes('OK-7391') ? { ok: true } : { ok: false, detail: JSON.stringify(t.slice(0, 60)) }; },
  },
  {
    id: 'L2', label: 'create, long verbatim content',
    setup() {},
    prompt: 'Create a file named sales_report.py whose content is exactly the following Python code, reproduced character for character:\n\n' + LONG,
    verify(d) { const g = read(d, 'sales_report.py'); return g === null ? { ok: false, detail: 'sales_report.py does not exist' } : norm(g) === norm(LONG) ? { ok: true } : { ok: false, detail: `content mismatch (${g.length} chars)` }; },
    baselineQuestion: 'Reply with exactly the following Python code and nothing else, no code fences:\n\n' + LONG,
    baselineVerify(t) { const s = t.replace(/^```[a-z]*\n|```\s*$/g, ''); return norm(s) === norm(LONG) ? { ok: true } : { ok: false, detail: `mismatch (${t.length} chars)` }; },
  },
  {
    id: 'L3', label: 'replace one value',
    setup(d) { fs.writeFileSync(path.join(d, 'config.ini'), '[server]\nhost = 127.0.0.1\nport = 8080\nworkers = 4\n', 'utf8'); },
    prompt: 'In config.ini, change the port from 8080 to 9090. Leave every other line unchanged.',
    verify(d) { const g = read(d, 'config.ini'); return g === null ? { ok: false, detail: 'config.ini does not exist' } : norm(g) === norm('[server]\nhost = 127.0.0.1\nport = 9090\nworkers = 4') ? { ok: true } : { ok: false, detail: `content ${JSON.stringify(g.slice(0, 80))}` }; },
  },
  {
    id: 'L4', label: 'create, then replace in the same file',
    setup() {},
    prompt: 'Create todo.md containing exactly these three lines:\n- [ ] buy milk\n- [ ] call Sam\n- [ ] file taxes\nThen, as a separate edit, mark "buy milk" as done by changing its "[ ]" to "[x]".',
    verify(d) { const g = read(d, 'todo.md'); return g === null ? { ok: false, detail: 'todo.md does not exist' } : norm(g) === norm('- [x] buy milk\n- [ ] call Sam\n- [ ] file taxes') ? { ok: true } : { ok: false, detail: `content ${JSON.stringify(g.slice(0, 80))}` }; },
  },
  {
    id: 'L5', label: 'insert a line after line N',
    setup(d) { fs.writeFileSync(path.join(d, 'steps.txt'), 'alpha\nbravo\ndelta\necho', 'utf8'); },
    prompt: 'steps.txt lists words one per line. Insert a new line containing exactly charlie after line 2 (after bravo), without changing any other line.',
    verify(d) { const g = read(d, 'steps.txt'); return g === null ? { ok: false, detail: 'steps.txt does not exist' } : norm(g) === norm('alpha\nbravo\ncharlie\ndelta\necho') ? { ok: true } : { ok: false, detail: `content ${JSON.stringify(g.slice(0, 80))}` }; },
  },
  {
    id: 'L6', label: 'view, then create a derived file',
    setup(d) { fs.writeFileSync(path.join(d, 'data.txt'), '12\n7\n30\n', 'utf8'); },
    prompt: 'data.txt contains one integer per line. Look at it, then create sum.txt containing only the sum of those integers, as digits.',
    verify(d) { const g = read(d, 'sum.txt'); return g === null ? { ok: false, detail: 'sum.txt does not exist' } : g.trim() === '49' ? { ok: true } : { ok: false, detail: `sum.txt is ${JSON.stringify(g.slice(0, 20))}` }; },
  },
];

module.exports = { ARMS, MUX_TOOLS, SPLIT_TOOLS, REQUIRES, CONTENT_OPS, ALL_PARAMS, interpret, execute, TASKS, LONG, norm };
