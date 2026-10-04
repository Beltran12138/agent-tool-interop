'use strict';

const fs = require('fs');
const path = require('path');
const S05 = require('./slice05');

/**
 * Slice 0.6 — reproduce the OpenHands first-create omission on Kimi K3, then ablate.
 * Pre-registered in BENCH-DESIGN.md (commit e357b3c) before this file existed.
 *
 * The OpenHands surface (system prompt + five tool schemas) is loaded from
 * assets/openhands-1.44.1, which was generated from the MIT-licensed packages,
 * never hand-copied. Ablations remove exactly one component from it.
 */

const ASSETS = path.join(__dirname, 'assets', 'openhands-1.44.1');
const OH_TOOLS = JSON.parse(fs.readFileSync(path.join(ASSETS, 'tools.json'), 'utf8'));
const OH_SYSTEM_BODY = fs.readFileSync(path.join(ASSETS, 'system_prompt.txt'), 'utf8').replace(/\r\n/g, '\n');
const WORKSPACE = '/workspace';
const META = ['security_risk', 'summary'];

function ohSystem(now = new Date()) {
  // Same block OpenHands appends: minute resolution, no timezone suffix.
  const stamp = now.toISOString().slice(0, 16);
  return `${OH_SYSTEM_BODY}\n\n<CURRENT_DATETIME>\nThe current date and time is: ${stamp}\n</CURRENT_DATETIME>`;
}

const clone = (x) => JSON.parse(JSON.stringify(x));

function stripMeta(tool) {
  const t = clone(tool);
  const p = t.function.parameters;
  for (const k of META) delete (p.properties || {})[k];
  if (Array.isArray(p.required)) p.required = p.required.filter((k) => !META.includes(k));
  return t;
}

/** The surface for an arm. `baseSystem` is Slice 0.5's prompt (passed in to avoid a cycle). */
function surface(arm, baseSystem) {
  const muxEditor = S05.MUX_TOOLS[0];
  switch (arm) {
    case 'OH': return { system: ohSystem(), tools: clone(OH_TOOLS), family: 'OH' };
    case 'BASE': return { system: baseSystem, tools: clone(S05.MUX_TOOLS), family: 'BASE' };
    case 'A-meta': return { system: ohSystem(), tools: OH_TOOLS.map(stripMeta), family: 'OH' };
    case 'A-desc': {
      const tools = clone(OH_TOOLS);
      tools.find((t) => t.function.name === 'file_editor').function.description = muxEditor.function.description;
      return { system: ohSystem(), tools, family: 'OH' };
    }
    case 'A-sys': return { system: baseSystem, tools: clone(OH_TOOLS), family: 'OH' };
    case 'A-solo': return { system: ohSystem(), tools: clone(OH_TOOLS.filter((t) => t.function.name === 'file_editor')), family: 'OH' };
    default: throw new Error(`unknown arm ${arm}`);
  }
}
const ARMS = ['OH', 'BASE', 'A-meta', 'A-desc', 'A-sys', 'A-solo'];

/** Map an OpenHands-style path into the sandbox. Returns null if it is outside /workspace. */
function mapPath(p) {
  if (typeof p !== 'string' || p === '') return null;
  if (p === WORKSPACE || p === WORKSPACE + '/') return '.';
  if (p.startsWith(WORKSPACE + '/')) return p.slice(WORKSPACE.length + 1);
  if (p.startsWith('/')) return null;
  return p;
}

/**
 * OpenHands file_editor semantics, as far as the measure needs them.
 * `str_replace` takes an optional `new_str` (OpenHands: "if not given, no string
 * will be added"), unlike Slice 0.5's REQUIRES. `create` refuses an existing path.
 */
const OH_REQUIRES = { view: ['path'], create: ['path', 'file_text'], str_replace: ['path', 'old_str'], insert: ['path', 'insert_line', 'new_str'], undo_edit: ['path'] };

function interpretOH(name, args) {
  const a = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  const present = (k) => k in a && a[k] !== null && a[k] !== undefined;
  const meta = META.filter((k) => k in a);
  if (name !== 'file_editor') return { tool: name, op: null, missing: [], meta };
  if (!present('command') || !OH_REQUIRES[a.command]) {
    return { tool: name, op: null, commandAbsent: true, missing: [], meta, error: 'Parameter `command` is required and must be one of: view, create, str_replace, insert, undo_edit.' };
  }
  const missing = OH_REQUIRES[a.command].filter((k) => !present(k));
  return { tool: name, op: a.command, missing, meta, error: missing.length ? `Parameter \`${missing[0]}\` is required for command: ${a.command}.` : null };
}

function execFileEditor(dir, a) {
  const rel = mapPath(a.path);
  if (rel === null) return `Error: Invalid \`path\` parameter: ${a.path}. The path should be inside ${WORKSPACE}.`;
  if (a.command === 'create') {
    const f = path.resolve(dir, rel);
    if (fs.existsSync(f)) return `Error: Invalid \`path\` parameter: ${a.path}. File already exists at: ${a.path}. Cannot overwrite files using command \`create\`.`;
  }
  if (a.command === 'undo_edit') return 'Error: No edit history found.';
  if (a.command === 'view') {
    const f = path.resolve(dir, rel);
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) return fs.readdirSync(f).map((n) => `${WORKSPACE}/${n}`).join('\n') || '(empty)';
  }
  const op = a.command;
  const b = { ...a, path: rel, new_str: op === 'str_replace' && a.new_str == null ? '' : a.new_str };
  return S05.execute(dir, op, b);
}

/** Read-only emulation. Nothing a model writes is ever executed on the host. */
const TERMINAL_UNAVAILABLE = 'This command is not available in this sandbox. Available: ls, cat, pwd, head, wc. Use file_editor to create or edit files.';
function execTerminal(dir, a) {
  const cmd = String((a && a.command) || '').trim();
  if (cmd === 'pwd') return WORKSPACE;
  const m = cmd.match(/^(ls|cat|head|wc)(?:\s+(-[a-zA-Z0-9]+))?(?:\s+(\S+))?\s*$/);
  if (!m) return TERMINAL_UNAVAILABLE;
  const target = m[3] ? mapPath(m[3]) : '.';
  if (target === null) return `${m[1]}: cannot access '${m[3]}': No such file or directory`;
  const f = path.resolve(dir, target);
  if (!f.startsWith(path.resolve(dir)) || !fs.existsSync(f)) return `${m[1]}: cannot access '${m[3] || '.'}': No such file or directory`;
  if (m[1] === 'ls') return fs.statSync(f).isDirectory() ? fs.readdirSync(f).join('\n') : path.basename(f);
  if (fs.statSync(f).isDirectory()) return `${m[1]}: ${m[3]}: Is a directory`;
  const text = fs.readFileSync(f, 'utf8');
  if (m[1] === 'cat') return text;
  if (m[1] === 'head') return text.split('\n').slice(0, 10).join('\n');
  return `${text.split('\n').length - 1} ${m[3]}`;
}

function execOH(dir, name, args) {
  switch (name) {
    case 'file_editor': return execFileEditor(dir, args);
    case 'terminal': return execTerminal(dir, args);
    case 'task_tracker': return 'Task list updated.';
    case 'think': return 'Your thought has been logged.';
    case 'finish': return 'Finished.';
    default: return `Error: no such tool: ${name}`;
  }
}

// --- tasks: create-first, paths under /workspace ----------------------------
const T05 = Object.fromEntries(S05.TASKS.map((t) => [t.id, t]));
const TASKS = [
  { ...T05.L1, prompt: 'Create a file at /workspace/notes.txt whose entire content is exactly: OK-7391' },
  { ...T05.L2, prompt: 'Create a file at /workspace/sales_report.py whose content is exactly the following Python code, reproduced character for character:\n\n' + S05.LONG },
  { ...T05.L4, prompt: 'Create /workspace/todo.md containing exactly these three lines:\n- [ ] buy milk\n- [ ] call Sam\n- [ ] file taxes\nThen, as a separate edit, mark "buy milk" as done by changing its "[ ]" to "[x]".' },
  { ...T05.L6, prompt: '/workspace/data.txt contains one integer per line. Look at it, then create /workspace/sum.txt containing only the sum of those integers, as digits.' },
  {
    id: 'L7', label: 'create a self-authored script',
    setup() {},
    prompt: 'Write a Python script at /workspace/fib.py that prints the first 15 Fibonacci numbers, one per line, starting from 0.',
    verify(d) {
      const f = path.join(d, 'fib.py');
      if (!fs.existsSync(f)) return { ok: false, detail: 'fib.py does not exist' };
      const g = fs.readFileSync(f, 'utf8');
      return /print/.test(g) && g.trim().length > 20 ? { ok: true } : { ok: false, detail: `content ${JSON.stringify(g.slice(0, 60))}` };
    },
  },
];

module.exports = { OH_TOOLS, OH_SYSTEM_BODY, ohSystem, surface, ARMS, stripMeta, mapPath, interpretOH, execOH, execTerminal, TERMINAL_UNAVAILABLE, TASKS, META, WORKSPACE };
