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
 */

// --- tool definitions -------------------------------------------------------
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
    parameters: {
      path: { type: 'string', description: 'File path relative to the working directory.', required: true },
    },
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
    parameters: {
      path: { type: 'string', description: 'Directory path relative to the working directory.', required: true },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete a file permanently.',
    parameters: {
      path: { type: 'string', description: 'File path relative to the working directory.', required: true },
    },
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// --- execution --------------------------------------------------------------
function safeJoin(dir, p) {
  if (typeof p !== 'string' || p === '') throw new Error('path must be a non-empty string');
  const resolved = path.resolve(dir, p);
  if (!resolved.startsWith(path.resolve(dir))) throw new Error('path escapes the sandbox');
  return resolved;
}

/**
 * Validate arguments against the declared schema BEFORE executing.
 * A schema violation is F2 and must not be papered over by coercion.
 */
function validateArgs(toolName, args) {
  const tool = TOOLS_BY_NAME.get(toolName);
  if (!tool) return { ok: false, unknownTool: true, detail: `no such tool: ${toolName}` };
  for (const [k, spec] of Object.entries(tool.parameters)) {
    if (spec.required && !(k in args)) return { ok: false, detail: `missing required parameter: ${k}` };
    if (k in args && typeof args[k] !== 'string') {
      return { ok: false, detail: `parameter ${k} must be a string, got ${typeof args[k]}` };
    }
  }
  const extra = Object.keys(args).filter((k) => !(k in tool.parameters));
  if (extra.length) return { ok: false, detail: `undeclared parameters: ${extra.join(',')}` };
  return { ok: true };
}

function execute(dir, name, args) {
  try {
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
        return { ok: true, result: fs.readdirSync(safeJoin(dir, args.path || '.')).join('\n') };
      case 'delete_file':
        fs.unlinkSync(safeJoin(dir, args.path));
        return { ok: true, result: `deleted ${args.path}` };
      default:
        return { ok: false, result: `no such tool: ${name}` };
    }
  } catch (e) {
    // A tool that legitimately fails (missing file) still counts as executed:
    // the model gets the error back and may recover. This is not ERROR.
    return { ok: false, result: `tool error: ${String(e.message)}` };
  }
}

// --- tasks ------------------------------------------------------------------
const TASKS = [
  {
    id: 'T1',
    label: 'single call, exact content',
    setup() {},
    prompt: 'Create a file named report.txt whose entire content is exactly: OK-7391',
    expectedTool: 'write_file',
    baselineQuestion:
      'A file named report.txt must be created. Reply with ONLY the exact content that file should have, nothing else.',
    verify(dir) {
      const f = path.join(dir, 'report.txt');
      if (!fs.existsSync(f)) return { ok: false, detail: 'report.txt does not exist' };
      const got = fs.readFileSync(f, 'utf8').trim();
      return got === 'OK-7391'
        ? { ok: true }
        : { ok: false, detail: `report.txt content is ${JSON.stringify(got.slice(0, 80))}` };
    },
    baselineVerify(text) {
      return text.trim().includes('OK-7391')
        ? { ok: true }
        : { ok: false, detail: `answer did not contain OK-7391: ${JSON.stringify(text.slice(0, 80))}` };
    },
  },
  {
    id: 'T2',
    label: 'read then write (two-step chain)',
    setup(dir) {
      fs.writeFileSync(path.join(dir, 'input.txt'), 'alpha,beta,gamma', 'utf8');
    },
    prompt:
      'The file input.txt contains a comma-separated list. Read it, reverse the order of the items, ' +
      'and write the reversed comma-separated list into a new file named output.txt. ' +
      'output.txt must contain only the reversed list, with no spaces.',
    expectedTool: 'read_file',
    baselineQuestion:
      'The file input.txt contains: alpha,beta,gamma . The items must be written to output.txt in reverse order, ' +
      'comma-separated, no spaces. Reply with ONLY the exact content output.txt should have, nothing else.',
    verify(dir) {
      const f = path.join(dir, 'output.txt');
      if (!fs.existsSync(f)) return { ok: false, detail: 'output.txt does not exist' };
      const got = fs.readFileSync(f, 'utf8').trim();
      return got === 'gamma,beta,alpha'
        ? { ok: true }
        : { ok: false, detail: `output.txt content is ${JSON.stringify(got.slice(0, 80))}` };
    },
    baselineVerify(text) {
      return text.replace(/\s/g, '').includes('gamma,beta,alpha')
        ? { ok: true }
        : { ok: false, detail: `answer did not contain gamma,beta,alpha: ${JSON.stringify(text.slice(0, 80))}` };
    },
  },
  {
    id: 'T3',
    label: 'preserve existing content (tool-choice pressure)',
    setup(dir) {
      fs.writeFileSync(path.join(dir, 'log.txt'), 'line1\n', 'utf8');
    },
    prompt:
      'The file log.txt already has content that must NOT be lost. Add a new line containing exactly DONE ' +
      'to the end of log.txt.',
    expectedTool: 'append_file',
    baselineQuestion:
      'The file log.txt currently contains the single line "line1". A new line containing exactly DONE must be ' +
      'added to the end, without losing the existing line. Reply with ONLY the exact final content of log.txt.',
    verify(dir) {
      const f = path.join(dir, 'log.txt');
      if (!fs.existsSync(f)) return { ok: false, detail: 'log.txt does not exist' };
      const got = fs.readFileSync(f, 'utf8');
      const hasOld = got.includes('line1');
      const hasNew = /(^|\n)\s*DONE\s*$/.test(got.trimEnd() + '');
      if (hasOld && hasNew) return { ok: true };
      if (!hasOld) return { ok: false, detail: `existing content was destroyed: ${JSON.stringify(got.slice(0, 80))}` };
      return { ok: false, detail: `DONE not appended: ${JSON.stringify(got.slice(0, 80))}` };
    },
    baselineVerify(text) {
      const t = text.replace(/\s/g, '');
      return t.includes('line1') && t.includes('DONE')
        ? { ok: true }
        : { ok: false, detail: `answer missing line1/DONE: ${JSON.stringify(text.slice(0, 80))}` };
    },
  },
];

// --- controls ---------------------------------------------------------------
// BENCH-DESIGN.md rule 1: an easy positive control certifies a sensitivity that
// does not exist at realistic difficulty. Two controls, same task, differing
// only in tool density and the presence of a plausible distractor.
const CONTROLS = [
  { id: 'C-easy', label: 'positive control, single tool, no distractor', taskId: 'T1', toolNames: ['write_file'] },
  {
    id: 'C-dense',
    label: 'positive control, 5 tools, plausible distractor present',
    taskId: 'T1',
    toolNames: TOOLS.map((t) => t.name),
  },
];

module.exports = { TOOLS, TOOLS_BY_NAME, TASKS, CONTROLS, execute, validateArgs };
