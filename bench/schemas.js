'use strict';

/**
 * The independent variable: how tools are exposed to the backend.
 *
 * Every form describes the SAME five tools with the SAME semantics. Only the
 * envelope changes. Each form supplies:
 *   - buildRequest(tools)  -> { systemSuffix, toolsField }
 *   - parse(assistantText, message) -> { kind, ... }
 *   - renderResult(call, result) -> a message to append
 *
 * PARSING CONTRACT (BENCH-DESIGN.md rule 2 — the most important rule here):
 *   parse() must return one of
 *     { kind: 'call', name, args }        a tool call was found and read
 *     { kind: 'none' }                    AFFIRMATIVELY no tool-call structure present
 *     { kind: 'malformed', detail }       envelope present but unreadable
 *   It must never guess, never default, and never return 'none' because
 *   something threw. 'none' is a measurement; 'malformed' is a different
 *   measurement; a crash is neither.
 */

// --- reasoning-preamble handling -------------------------------------------
// Reasoning models emit <think> blocks. They must be removed before parsing,
// but the removal is recorded: a parser that silently eats content is a parser
// that can silently eat the answer.
function stripReasoning(text) {
  if (typeof text !== 'string') return { text: '', stripped: false };
  let out = text;
  let stripped = false;
  const patterns = [/<think>[\s\S]*?<\/think>/gi, /<thinking>[\s\S]*?<\/thinking>/gi];
  for (const p of patterns) {
    if (p.test(out)) {
      stripped = true;
      out = out.replace(p, '');
    }
  }
  // An unclosed <think> means the response was cut off mid-reasoning.
  // That is truncation, not absence of a tool call — flag it for the caller.
  const unclosed = /<think(ing)?>/i.test(out);
  return { text: out.trim(), stripped, unclosed };
}

function typeWord(spec) {
  if (spec.type === 'enum') return `string, one of: ${spec.enum.join(' | ')}`;
  if (spec.type === 'array') return `array of ${spec.items || 'values'}`;
  if (spec.type === 'object') return `object with keys: ${Object.keys(spec.schema || {}).join(', ')}`;
  return spec.type;
}

function describeToolsHuman(tools) {
  return tools
    .map((t) => {
      const params = Object.entries(t.parameters)
        .map(([k, v]) => `    - ${k} (${typeWord(v)})${v.required ? ' [required]' : ''}: ${v.description}`)
        .join('\n');
      return `  ${t.name}: ${t.description}\n${params}`;
    })
    .join('\n');
}

/** JSON Schema for a parameter — only the native form can carry this. */
function jsonSchemaFor(spec) {
  switch (spec.type) {
    case 'enum': return { type: 'string', enum: spec.enum, description: spec.description };
    case 'integer': return { type: 'integer', description: spec.description };
    case 'array': return { type: 'array', items: { type: spec.items || 'string' }, description: spec.description };
    case 'object': return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(spec.schema || {}).map(([k, t]) => [k, { type: t }])),
      required: Object.keys(spec.schema || {}),
      description: spec.description,
    };
    default: return { type: 'string', description: spec.description };
  }
}

// --- S0: no tool protocol at all (construct check) --------------------------
// Not a schema. This is the control that separates "cannot use this envelope"
// from "cannot do the task at all". Reported alongside, never averaged in.
const S0 = {
  id: 'S0',
  label: 'no tools — direct answer (construct check)',
  isBaseline: true,
  buildRequest() {
    return { toolsField: null, systemSuffix: '' };
  },
  parse() {
    throw new Error('S0 is scored by direct answer, not by parsing tool calls');
  },
};

// --- S1: native OpenAI-style function tools ---------------------------------
const S1 = {
  id: 'S1',
  label: 'native OpenAI-style function tools',
  buildRequest(tools) {
    return {
      toolsField: tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(t.parameters).map(([k, v]) => [k, jsonSchemaFor(v)])),
            required: Object.entries(t.parameters).filter(([, v]) => v.required).map(([k]) => k),
          },
        },
      })),
      systemSuffix: '',
    };
  },
  parse(_text, message) {
    const calls = message && message.tool_calls;
    if (!Array.isArray(calls) || calls.length === 0) {
      // Affirmative: the structured field exists in the protocol and is absent.
      return { kind: 'none' };
    }
    const c = calls[0];
    const name = c && c.function && c.function.name;
    if (!name) return { kind: 'malformed', detail: 'tool_call without function.name' };
    let args;
    try {
      args = JSON.parse(c.function.arguments || '{}');
    } catch (e) {
      return { kind: 'malformed', detail: `arguments not JSON: ${String(e.message).slice(0, 120)}` };
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      return { kind: 'malformed', detail: 'arguments not a JSON object' };
    }
    // Every call in the message, not just the first: the API contract requires
    // a tool result for each tool_call_id, and dropping the rest turns the
    // native form's parallelism into a transport error.
    const all = [];
    for (let i = 0; i < calls.length; i++) {
      const ci = calls[i];
      const nm = ci && ci.function && ci.function.name;
      if (!nm) return { kind: 'malformed', detail: `tool_call[${i}] without function.name` };
      let a;
      try { a = JSON.parse(ci.function.arguments || '{}'); } catch (e) {
        return { kind: 'malformed', detail: `tool_call[${i}] arguments not JSON: ${String(e.message).slice(0, 100)}` };
      }
      if (a === null || typeof a !== 'object' || Array.isArray(a)) {
        return { kind: 'malformed', detail: `tool_call[${i}] arguments not a JSON object` };
      }
      all.push({ name: nm, args: a, id: ci.id || `call_${i}`, dialect: 'specified' });
    }
    // Native tools have no dialect variance: the field is structured by the API.
    return { kind: 'call', name, args, id: c.id || 'call_0', dialect: 'specified', calls: all };
  },
  renderResult(call, result) {
    return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) };
  },
};

// --- S4: prompt-embedded XML (the shape shipped by real scaffolds) ----------
const XML_MARKER = /<tool_call>/i;
const S4 = {
  id: 'S4',
  label: 'prompt-embedded XML tool schema',
  buildRequest(tools) {
    return {
      toolsField: null,
      systemSuffix: `

You can call tools. The available tools are:

${describeToolsHuman(tools)}

To call a tool, emit EXACTLY this structure and nothing else after it:

<tool_call>
<function=TOOL_NAME>
<parameter=PARAM_NAME>value</parameter>
</function>
</tool_call>

Every parameter value is text. A parameter that is not a plain string — an array,
an object, or a number — must be written as its JSON encoding, for example
<parameter=tags>["a","b"]</parameter> or <parameter=retries>4</parameter>.

Inside a parameter value, escape the three XML metacharacters, otherwise the
value cannot be told apart from the markup around it:
  &  ->  &amp;      <  ->  &lt;      >  ->  &gt;
Escape & first. These are decoded before the value reaches the tool, so a value
containing </parameter> must be written as &lt;/parameter&gt;.

Emit one tool call at a time and then stop. The result will be given to you in a
<tool_result> block. When the task is complete, reply with DONE and no tool call.`,
    };
  },
  /**
   * DIALECT TOLERANCE — read this before touching the regexes.
   *
   * The prompt specifies `<function=NAME>` / `<parameter=NAME>`. Models
   * routinely emit the attribute dialect `<function name="NAME">` /
   * `<parameter name="NAME">` instead. Accepting only the specified dialect
   * would measure "did the model guess my exact literal syntax", and would let
   * a regex masquerade as the finding "prompt-embedded XML is brittle".
   * Accepting both silently would throw away the format-adherence signal, which
   * is the very phenomenon the model-side literature reports.
   *
   * So: parse tolerantly, and record which dialect was used. The outcome
   * reflects drivability under a tolerant parser; `dialect: 'variant'` records
   * that a strict scaffold would have rejected this call. Both numbers get
   * reported, which is strictly more informative than either alone.
   */
  parse(text) {
    if (!XML_MARKER.test(text)) return { kind: 'none' };
    const block = text.match(/<tool_call>([\s\S]*?)<\/tool_call>/i);
    if (!block) return { kind: 'malformed', detail: '<tool_call> opened but never closed' };
    const body = block[1];

    // MULTIPLE FUNCTIONS IN ONE BLOCK.
    //
    // The prompt says one call at a time, and an earlier version therefore read
    // only the first `<function>` — silently discarding any others. It then
    // reported "parallelism appeared only in the native form", a clean
    // directional claim that was false: one model attempted two calls in a
    // single XML block in 5 of 181 observed blocks, and every one of them was
    // thrown away before it could be counted. Silent drops do not merely lose
    // data, they manufacture the opposite finding.
    //
    // Every function block is surfaced now. Attempting parallelism in a form
    // that does not specify it is itself a measurement, not an error to hide.
    const fnBlocks = [];
    const fnRe = /<function(?:=([^>\s]+)|\s+name\s*=\s*["']([^"']+)["'])\s*>([\s\S]*?)(?=<function[=\s]|$)/gi;
    let fm;
    while ((fm = fnRe.exec(body)) !== null) {
      fnBlocks.push({ name: fm[1] || fm[2], dialect: fm[1] ? 'specified' : 'variant', body: fm[3] });
    }
    if (fnBlocks.length === 0) return { kind: 'malformed', detail: 'no function name in any known dialect' };

    let escapingUsed = false;
    let paramSyntaxFailure = false;
    let dialect = 'specified';

    const parseOne = (fb, idx) => {
      const rawArgs = {};
      let m;
      const specified = /<parameter=([^>\s]+)\s*>([\s\S]*?)<\/parameter>/gi;
      while ((m = specified.exec(fb.body)) !== null) rawArgs[m[1]] = m[2];
      const attr = /<parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;
      while ((m = attr.exec(fb.body)) !== null) {
        if (!(m[1] in rawArgs)) { rawArgs[m[1]] = m[2]; fb.dialect = 'variant'; }
      }

      // PARAMETER SYNTAX FAILURE, distinct from "no parameters were given".
      // Observed in the wild: `<parameter name="path>.</parameter>` (quote opened,
      // never closed) and `<parameter>content>42</parameter>` (no name marker at
      // all). Both parse to zero parameters, and an earlier version reported the
      // result as an argument omission — i.e. as a reasoning failure, when it was
      // a syntax failure. Counting the tags that are present and comparing tells
      // the two apart.
      const declared = (fb.body.match(/<parameter/gi) || []).length;
      if (declared > Object.keys(rawArgs).length) paramSyntaxFailure = true;

      const args = {};
      for (const [k, v] of Object.entries(rawArgs)) {
        if (/&(amp|lt|gt);/.test(v)) escapingUsed = true;
        args[k] = v.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      }
      if (fb.dialect === 'variant') dialect = 'variant';
      return { name: fb.name, args, id: `xml_${idx}`, dialect: fb.dialect };
    };

    const calls = fnBlocks.map(parseOne);
    return {
      kind: 'call',
      name: calls[0].name,
      args: calls[0].args,
      id: calls[0].id,
      dialect,
      escapingUsed,
      paramSyntaxFailure,
      calls,
    };
  },
  renderResult(call, result) {
    return { role: 'user', content: `<tool_result>\n${JSON.stringify(result)}\n</tool_result>` };
  },
};

// --- S5: prompt-embedded JSON, no native tool field at all (the floor) ------
// The marker must cover every dialect the parser accepts. A marker narrower
// than the parser converts a variant-dialect call into a false `none` — i.e.
// into the fabricated finding "this model emitted no tool call at all".
const JSON_MARKER = /"(tool|tool_name|name|function)"\s*:/;
const S5 = {
  id: 'S5',
  label: 'prompt-embedded JSON, no native tools field',
  buildRequest(tools) {
    return {
      toolsField: null,
      systemSuffix: `

You can call tools. The available tools are:

${describeToolsHuman(tools)}

To call a tool, reply with a single JSON object and nothing else:

{"tool": "TOOL_NAME", "args": {"PARAM": "value"}}

Emit one tool call at a time and then stop. The result will be given to you as a
JSON object. When the task is complete, reply with {"done": true}.`,
    };
  },
  parse(text) {
    if (!JSON_MARKER.test(text)) {
      // Distinguish "finished" from "said nothing tool-shaped".
      return { kind: 'none' };
    }
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fenced ? fenced[1] : text;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { kind: 'malformed', detail: '"tool": present but no JSON object delimiters' };
    }
    let obj;
    try {
      obj = JSON.parse(candidate.slice(start, end + 1));
    } catch (e) {
      return { kind: 'malformed', detail: `not valid JSON: ${String(e.message).slice(0, 120)}` };
    }
    // Same dialect-tolerance policy as S4: the prompt specifies {"tool","args"},
    // models commonly emit {"name","arguments"} or {"function","parameters"}.
    // Accept them, but record that a strict scaffold would have rejected it.
    let dialect = 'specified';
    let name = obj && typeof obj.tool === 'string' ? obj.tool : null;
    if (name === null && obj) {
      for (const k of ['name', 'function', 'tool_name']) {
        if (typeof obj[k] === 'string') { name = obj[k]; dialect = 'variant'; break; }
      }
    }
    if (name === null) return { kind: 'malformed', detail: 'JSON object lacks a string tool name in any known dialect' };

    let args = obj.args;
    if (args === undefined) {
      for (const k of ['arguments', 'parameters', 'params', 'input']) {
        if (obj[k] !== undefined) { args = obj[k]; dialect = 'variant'; break; }
      }
    }
    if (args !== undefined && (args === null || typeof args !== 'object' || Array.isArray(args))) {
      return { kind: 'malformed', detail: 'args present but not an object' };
    }
    return { kind: 'call', name, args: args || {}, id: 'json_0', dialect };
  },
  renderResult(call, result) {
    return { role: 'user', content: JSON.stringify({ tool_result: result }) };
  },
};

module.exports = { S0, S1, S4, S5, stripReasoning, FORMS: [S1, S4, S5] };
