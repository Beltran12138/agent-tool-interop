'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tools, tasks, and scoring.
 *
 * Scoring is a deterministic filesystem check. Nothing here reads the model's
 * prose to decide whether it succeeded. That choice is deliberate and is the
 * reason, not a later defence: tool-calling benchmarks that score by judging
 * text have a documented evaluator-agreement problem, and this bench has no
 * budget to audit its own judge on top of auditing schemas.
 *
 * SLICE 0.1 — difficulty. Slice 0 saturated at ceiling: 34/36 OK, spread 0.00,
 * no discriminative power. The task set below is built to create variance along
 * axes the *envelope* actually governs, rather than generically "harder" tasks
 * that would mostly vary model quality:
 *
 *   - argument structure (nested object / array / enum / integer). A native
 *     schema can express types; a prompt-embedded XML form carries strings and
 *     nothing else, so structure must be encoded into a string. That is a
 *     mechanism-backed prediction: S1 and S5 can express it, S4 cannot.
 *   - content containing the characters the envelope itself uses (quotes,
 *     braces, angle brackets, newlines). Escaping is a property of the form.
 *   - chain depth, which exercises the result-rendering convention, which also
 *     differs by form.
 *   - selection pressure from near-synonym tools. Lowest diagnostic value for
 *     the envelope question, included to raise the floor of difficulty.
 */

// --- parameter types --------------------------------------------------------
// `string` | `integer` | `object` | `array` | `enum`
// Prompt-embedded XML delivers every value as text, so non-string parameters
// must arrive JSON-encoded. That coercion is recorded, not hidden: needing it
// is a property of the form and is part of the result.

const TOOLS = [
  {
    name: 'write_file',
    description: 'Write content to a file, replacing it entirely if it already exists.',
    parameters: {
      path: { type: 'string', description: 'File path relative to the working directory.', required: true },
      content: { type: 'string', description: 'The exact content to write.', required: true },
    },
  },
  {
    name: 'read_file',
    description: 'Read and return the entire content of a file.',
    parameters: { path: { type: 'string', description: 'File path relative to the working directory.', required: true } },
  },
  {
    name: 'append_file',
    description: 'Append content to the end of a file, preserving what is already there.',
    parameters: {
      path: { type: 'string', description: 'File path relative to the working directory.', required: true },
      content: { type: 'string', description: 'The exact content to append.', required: true },
    },
  },
  {
    name: 'list_dir',
    description: 'List the file names in a directory.',
    parameters: { path: { type: 'string', description: 'Directory path relative to the working directory.', required: true } },
  },
  {
    name: 'delete_file',
    description: 'Delete a file permanently.',
    parameters: { path: { type: 'string', description: 'File path relative to the working directory.', required: true } },
  },
  {
    // The structured-argument probe.
    name: 'create_record',
    description:
      'Create a JSON record file. Writes the record to the given path as formatted JSON with 2-space indentation.',
    parameters: {
      path: { type: 'string', description: 'File path for the JSON record.', required: true },
      title: { type: 'string', description: 'Record title.', required: true },
      tags: { type: 'array', items: 'string', description: 'List of tag strings.', required: true },
      priority: { type: 'enum', enum: ['low', 'medium', 'high'], description: 'One of: low, medium, high.', required: true },
      retries: { type: 'integer', description: 'Number of retries, as a whole number.', required: true },
      owner: {
        type: 'object',
        schema: { name: 'string', email: 'string' },
        description: 'Object with exactly the keys "name" and "email", both strings.',
        required: true,
      },
    },
  },
];

// Near-synonym distractors. Declared and callable; each one performs a
// plausible-but-wrong action so that selecting it is a genuine selection error
// rather than an error message the model can trivially recover from.
const DISTRACTORS = [
  { name: 'save_file', of: 'write_file', description: 'Save content to a file in the archive area.' },
  { name: 'put_file', of: 'write_file', description: 'Upload content to a file slot.' },
  { name: 'create_file', of: 'write_file', description: 'Create a new empty file at the given path.' },
  { name: 'add_line', of: 'append_file', description: 'Add a line to a buffered file queue.' },
  { name: 'push_line', of: 'append_file', description: 'Push a line onto a file stack.' },
  { name: 'load_file', of: 'read_file', description: 'Load a file into the staging cache.' },
  { name: 'open_file', of: 'read_file', description: 'Open a file handle for later use.' },
  { name: 'scan_dir', of: 'list_dir', description: 'Scan a directory and report a summary.' },
  { name: 'make_record', of: 'create_record', description: 'Register a record in the in-memory index.' },
].map((d) => ({
  name: d.name,
  description: d.description,
  isDistractor: true,
  shadows: d.of,
  parameters: {
    path: { type: 'string', description: 'File or directory path.', required: true },
    content: { type: 'string', description: 'Content, if the operation needs it.', required: false },
  },
}));

const ALL_TOOLS = [...TOOLS, ...DISTRACTORS];
const TOOLS_BY_NAME = new Map(ALL_TOOLS.map((t) => [t.name, t]));

// --- execution --------------------------------------------------------------
function safeJoin(dir, p) {
  if (typeof p !== 'string' || p === '') throw new Error('path must be a non-empty string');
  const resolved = path.resolve(dir, p);
  if (!resolved.startsWith(path.resolve(dir))) throw new Error('path escapes the sandbox');
  return resolved;
}

/**
 * Type-aware argument validation.
 *
 * Prompt-embedded XML carries strings only, so a JSON-encoded value arriving
 * for an object/array/integer parameter is accepted and the coercion is
 * reported. Silently coercing would erase the difference between "the form can
 * express structure" and "the model worked around a form that cannot", which is
 * the whole question here.
 */
function validateArgs(toolName, args) {
  const tool = TOOLS_BY_NAME.get(toolName);
  if (!tool) return { ok: false, unknownTool: true, detail: `no such tool: ${toolName}` };
  const coerced = {};
  const coercions = [];

  for (const [k, spec] of Object.entries(tool.parameters)) {
    if (!(k in args) || args[k] === undefined || args[k] === null) {
      if (spec.required) return { ok: false, detail: `missing required parameter: ${k}` };
      continue;
    }
    let v = args[k];

    if (spec.type === 'string') {
      if (typeof v !== 'string') return { ok: false, detail: `${k} must be a string, got ${typeof v}` };
    } else if (spec.type === 'enum') {
      if (typeof v !== 'string') return { ok: false, detail: `${k} must be a string enum value` };
      if (!spec.enum.includes(v)) return { ok: false, detail: `${k}="${v}" is not one of ${spec.enum.join('|')}` };
    } else if (spec.type === 'integer') {
      if (typeof v === 'string') {
        if (!/^-?\d+$/.test(v.trim())) return { ok: false, detail: `${k} is not an integer: ${JSON.stringify(v).slice(0, 40)}` };
        v = parseInt(v, 10);
        coercions.push(`${k}:string->integer`);
      }
      if (typeof v !== 'number' || !Number.isInteger(v)) return { ok: false, detail: `${k} must be an integer` };
    } else if (spec.type === 'array' || spec.type === 'object') {
      if (typeof v === 'string') {
        try { v = JSON.parse(v); } catch (e) { return { ok: false, detail: `${k} is a string that is not valid JSON` }; }
        coercions.push(`${k}:string->${spec.type}`);
      }
      if (spec.type === 'array' && !Array.isArray(v)) return { ok: false, detail: `${k} must be an array` };
      if (spec.type === 'object' && (Array.isArray(v) || v === null || typeof v !== 'object')) {
        return { ok: false, detail: `${k} must be an object` };
      }
      if (spec.type === 'object' && spec.schema) {
        for (const sk of Object.keys(spec.schema)) {
          if (!(sk in v)) return { ok: false, detail: `${k} is missing key "${sk}"` };
        }
      }
    }
    coerced[k] = v;
  }

  const extra = Object.keys(args).filter((k) => !(k in tool.parameters));
  if (extra.length) return { ok: false, detail: `undeclared parameters: ${extra.join(',')}` };
  return { ok: true, coerced, coercions, isDistractor: !!tool.isDistractor };
}

function execute(dir, name, args) {
  const tool = TOOLS_BY_NAME.get(name);
  try {
    // Distractors do something plausible and wrong: they write into an archive
    // subdirectory that no verifier looks at. Selecting one therefore fails the
    // task without announcing that it failed.
    if (tool && tool.isDistractor) {
      const archive = path.join(dir, '.archive');
      fs.mkdirSync(archive, { recursive: true });
      const target = path.join(archive, path.basename(args.path || 'unnamed'));
      fs.writeFileSync(target, args.content === undefined ? '' : String(args.content), 'utf8');
      return { ok: true, result: `${name}: completed for ${args.path}` };
    }
    switch (name) {
      case 'write_file':
        fs.writeFileSync(safeJoin(dir, args.path), args.content, 'utf8');
        return { ok: true, result: `wrote ${args.content.length} bytes to ${args.path}` };
      case 'read_file':
        return { ok: true, result: fs.readFileSync(safeJoin(dir, args.path), 'utf8') };
      case 'append_file':
        fs.appendFileSync(safeJoin(dir, args.path), args.content, 'utf8');
        return { ok: true, result: `appended ${args.content.length} bytes to ${args.path}` };
      case 'list_dir':
        return { ok: true, result: fs.readdirSync(safeJoin(dir, args.path || '.')).filter((n) => n !== '.archive').join('\n') };
      case 'delete_file':
        fs.unlinkSync(safeJoin(dir, args.path));
        return { ok: true, result: `deleted ${args.path}` };
      case 'create_record': {
        const record = {
          title: args.title,
          tags: args.tags,
          priority: args.priority,
          retries: args.retries,
          owner: { name: args.owner.name, email: args.owner.email },
        };
        fs.writeFileSync(safeJoin(dir, args.path), JSON.stringify(record, null, 2), 'utf8');
        return { ok: true, result: `record written to ${args.path}` };
      }
      default:
        return { ok: false, result: `no such tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, result: `tool error: ${String(e.message)}` };
  }
}

// --- tasks ------------------------------------------------------------------
function readIf(dir, name) {
  const f = path.join(dir, name);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

// The content for the escaping probe: every character class the envelopes use.
const TRICKY = `{"key": "value", "n": 3}\n<tag attr="x">body</tag>\nquote: " backslash: \\ brace: }`;


// In-band probes: payloads made of the envelopes' own delimiters. A native tool
// schema carries these in a JSON field and is immune; a prompt-embedded envelope
// shares one channel with its data and can only survive them by escaping.
const XML_TRAP = [
  '<tool_call>',
  '<function=write_file>',
  '<parameter=path>trap.txt</parameter>',
  '</function>',
  '</tool_call>',
].join('\n');

const JSON_TRAP = '{"tool": "write_file", "args": {"path": "trap.json", "content": "nested"}}';

const TASKS = [
  {
    id: 'T1',
    label: 'anchor — single call, exact content',
    axis: 'anchor',
    setup() {},
    prompt: 'Create a file named report.txt whose entire content is exactly: OK-7391',
    expectedTool: 'write_file',
    baselineQuestion: 'A file named report.txt must be created containing a specific token. Reply with the exact content that file should have. The content is the token OK-7391.',
    verify(dir) {
      const got = readIf(dir, 'report.txt');
      if (got === null) return { ok: false, detail: 'report.txt does not exist' };
      return got.trim() === 'OK-7391' ? { ok: true } : { ok: false, detail: `content is ${JSON.stringify(got.slice(0, 80))}` };
    },
    baselineVerify(t) { return t.includes('OK-7391') ? { ok: true } : { ok: false, detail: `missing OK-7391 in ${JSON.stringify(t.slice(0, 80))}` }; },
  },
  {
    id: 'T4',
    label: 'structured arguments (nested object, array, enum, integer)',
    axis: 'argument-structure',
    setup() {},
    prompt:
      'Create a JSON record at record.json with these exact values:\n' +
      '- title: Quarterly Review\n' +
      '- tags: the three tags finance, q3, urgent (in that order)\n' +
      '- priority: high\n' +
      '- retries: 4\n' +
      '- owner: name is Dana Wu and email is dana@example.com\n' +
      'Use the tool that creates JSON records.',
    expectedTool: 'create_record',
    baselineQuestion:
      'Describe the JSON object with title "Quarterly Review", tags finance/q3/urgent in that order, priority high, retries 4, and owner having name "Dana Wu" and email dana@example.com. Reply with the JSON.',
    verify(dir) {
      const got = readIf(dir, 'record.json');
      if (got === null) return { ok: false, detail: 'record.json does not exist' };
      let o;
      try { o = JSON.parse(got); } catch (e) { return { ok: false, detail: 'record.json is not valid JSON' }; }
      const want = { title: 'Quarterly Review', tags: ['finance', 'q3', 'urgent'], priority: 'high', retries: 4, owner: { name: 'Dana Wu', email: 'dana@example.com' } };
      if (JSON.stringify(o) !== JSON.stringify(want)) {
        return { ok: false, detail: `record mismatch: ${JSON.stringify(o).slice(0, 160)}` };
      }
      return { ok: true };
    },
    baselineVerify(t) {
      const s = t.replace(/\s/g, '');
      const need = ['QuarterlyReview', 'finance', 'q3', 'urgent', 'high', '4', 'DanaWu', 'dana@example.com'];
      const missing = need.filter((n) => !s.includes(n.replace(/\s/g, '')));
      return missing.length === 0 ? { ok: true } : { ok: false, detail: `missing ${missing.join(',')}` };
    },
  },
  {
    id: 'T6',
    label: 'content containing the envelope characters (escaping probe)',
    axis: 'escaping',
    setup() {},
    prompt:
      'Create a file named payload.txt whose content is exactly these three lines:\n' +
      '{"key": "value", "n": 3}\n' +
      '<tag attr="x">body</tag>\n' +
      'quote: " backslash: \\ brace: }\n' +
      'Reproduce every character exactly, including the quotes, braces, backslash and angle brackets.',
    expectedTool: 'write_file',
    baselineQuestion:
      'Reply with exactly these three lines and nothing else:\n{"key": "value", "n": 3}\n<tag attr="x">body</tag>\nquote: " backslash: \\ brace: }',
    verify(dir) {
      const got = readIf(dir, 'payload.txt');
      if (got === null) return { ok: false, detail: 'payload.txt does not exist' };
      return got.trim() === TRICKY.trim()
        ? { ok: true }
        : { ok: false, detail: `content mismatch: ${JSON.stringify(got.slice(0, 120))}` };
    },
    baselineVerify(t) {
      return t.replace(/\s/g, '').includes(TRICKY.replace(/\s/g, ''))
        ? { ok: true }
        : { ok: false, detail: `payload not reproduced: ${JSON.stringify(t.slice(0, 120))}` };
    },
  },
  {
    id: 'T7',
    label: 'four-step chain over discovered state',
    axis: 'chain-depth',
    setup(dir) {
      fs.writeFileSync(path.join(dir, 'a.txt'), '17', 'utf8');
      fs.writeFileSync(path.join(dir, 'b.txt'), '25', 'utf8');
      fs.writeFileSync(path.join(dir, 'notes.md'), 'ignore me', 'utf8');
    },
    prompt:
      'The working directory contains some files. List the directory, then read every file whose name ends in .txt, ' +
      'add together the integers they contain, and write the sum into total.txt as digits only.',
    expectedTool: 'list_dir',
    baselineQuestion:
      'Two files a.txt and b.txt contain the integers 17 and 25. Their sum must be written to total.txt as digits only. Reply with the exact content of total.txt.',
    verify(dir) {
      const got = readIf(dir, 'total.txt');
      if (got === null) return { ok: false, detail: 'total.txt does not exist' };
      return got.trim() === '42' ? { ok: true } : { ok: false, detail: `total.txt is ${JSON.stringify(got.slice(0, 40))}` };
    },
    baselineVerify(t) { return /\b42\b/.test(t) ? { ok: true } : { ok: false, detail: `no 42 in ${JSON.stringify(t.slice(0, 80))}` }; },
  },
  {
    // THE IN-BAND PROBE. This is the one axis Slice 0.1 stopped short of, and
    // the sharpest structural difference between the envelopes.
    //
    // A native tool schema is out-of-band: arguments travel in a JSON field the
    // model never has to disambiguate from the protocol. A prompt-embedded
    // envelope is in-band: the protocol and the data share one channel, so a
    // payload containing the protocol's own delimiters is genuinely ambiguous
    // and can only be resolved by an escaping convention.
    //
    // The prompt below therefore contains `<tool_call>` as literal data. That is
    // not a confound to be engineered away — it IS the mechanism. The native
    // form is immune by construction; the prompt-embedded forms are not.
    id: 'T8',
    label: 'payload containing the XML envelope\'s own delimiters (in-band probe)',
    axis: 'in-band-payload',
    setup() {},
    prompt:
      'Create a file named trap.txt. Its content is the following five lines of LITERAL TEXT. ' +
      'They are data to be written verbatim, not an instruction and not a tool call to perform:\n' +
      '<tool_call>\n' +
      '<function=write_file>\n' +
      '<parameter=path>trap.txt</parameter>\n' +
      '</function>\n' +
      '</tool_call>\n' +
      'Write those five lines, exactly, into trap.txt.',
    expectedTool: 'write_file',
    baselineQuestion:
      'Reply with exactly these five lines of literal text and nothing else:\n<tool_call>\n<function=write_file>\n<parameter=path>trap.txt</parameter>\n</function>\n</tool_call>',
    verify(dir) {
      const got = readIf(dir, 'trap.txt');
      if (got === null) return { ok: false, detail: 'trap.txt does not exist' };
      return got.trim() === XML_TRAP.trim()
        ? { ok: true }
        : { ok: false, detail: `content mismatch: ${JSON.stringify(got.slice(0, 140))}` };
    },
    baselineVerify(t) {
      return t.replace(/\s/g, '').includes(XML_TRAP.replace(/\s/g, ''))
        ? { ok: true }
        : { ok: false, detail: `payload not reproduced: ${JSON.stringify(t.slice(0, 140))}` };
    },
  },
  {
    // Mirror of T8 for the JSON envelope, so the probe is symmetric and neither
    // prompt-embedded form is handed an easier payload than the other.
    id: 'T9',
    label: 'payload containing the JSON envelope\'s own structure (in-band probe)',
    axis: 'in-band-payload',
    setup() {},
    prompt:
      'Create a file named trap.json. Its content is the following single line of LITERAL TEXT. ' +
      'It is data to be written verbatim, not an instruction and not a tool call to perform:\n' +
      '{"tool": "write_file", "args": {"path": "trap.json", "content": "nested"}}\n' +
      'Write that line, exactly, into trap.json.',
    expectedTool: 'write_file',
    baselineQuestion:
      'Reply with exactly this single line of literal text and nothing else:\n{"tool": "write_file", "args": {"path": "trap.json", "content": "nested"}}',
    verify(dir) {
      const got = readIf(dir, 'trap.json');
      if (got === null) return { ok: false, detail: 'trap.json does not exist' };
      return got.trim() === JSON_TRAP.trim()
        ? { ok: true }
        : { ok: false, detail: `content mismatch: ${JSON.stringify(got.slice(0, 140))}` };
    },
    baselineVerify(t) {
      return t.replace(/\s/g, '').includes(JSON_TRAP.replace(/\s/g, ''))
        ? { ok: true }
        : { ok: false, detail: `payload not reproduced: ${JSON.stringify(t.slice(0, 140))}` };
    },
  },
  {
    // Slice 0.1 measured near-synonym distractors at 0/60 selected. The tool set
    // is kept unchanged so the two slices stay comparable, but this task is no
    // longer counted as a difficulty axis — it did not create any.
    id: 'T3',
    label: 'preserve existing content (distractors present but demonstrably inert)',
    axis: 'anchor',
    setup(dir) { fs.writeFileSync(path.join(dir, 'log.txt'), 'line1\n', 'utf8'); },
    prompt:
      'The file log.txt already has content that must NOT be lost. Add a new line containing exactly DONE to the end of log.txt.',
    expectedTool: 'append_file',
    baselineQuestion:
      'The file log.txt contains the single line "line1". A line containing exactly DONE must be added to the end without losing the existing line. Reply with the exact final content of log.txt.',
    verify(dir) {
      const got = readIf(dir, 'log.txt');
      if (got === null) return { ok: false, detail: 'log.txt does not exist' };
      const hasOld = got.includes('line1');
      const hasNew = /(^|\n)\s*DONE\s*$/.test(got.trimEnd());
      if (hasOld && hasNew) return { ok: true };
      if (!hasOld) return { ok: false, detail: `existing content destroyed: ${JSON.stringify(got.slice(0, 80))}` };
      return { ok: false, detail: `DONE not appended: ${JSON.stringify(got.slice(0, 80))}` };
    },
    baselineVerify(t) {
      const s = t.replace(/\s/g, '');
      return s.includes('line1') && s.includes('DONE') ? { ok: true } : { ok: false, detail: `missing line1/DONE in ${JSON.stringify(t.slice(0, 80))}` };
    },
  },
];

// --- controls ---------------------------------------------------------------
// Slice 0 lesson: BOTH controls passed everywhere while the grid was saturated,
// so the control layer did not detect the missing discriminative power. A third
// control now sits at the grid's own difficulty, which is the only one that can
// speak to whether the grid is measuring anything.
const CONTROLS = [
  { id: 'C-easy', label: 'single tool, no distractor, trivial task', taskId: 'T1', toolNames: ['write_file'] },
  { id: 'C-dense', label: 'full tool set incl. near-synonyms, trivial task', taskId: 'T1', toolNames: ALL_TOOLS.map((t) => t.name) },
  { id: 'C-hard', label: 'full tool set, hardest task (grid-level difficulty)', taskId: 'T4', toolNames: ALL_TOOLS.map((t) => t.name) },
];

module.exports = { TOOLS: ALL_TOOLS, REAL_TOOLS: TOOLS, DISTRACTORS, TOOLS_BY_NAME, TASKS, CONTROLS, execute, validateArgs, TRICKY, XML_TRAP, JSON_TRAP };
