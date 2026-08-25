'use strict';

/**
 * Backend registry.
 *
 * Credentials come from the environment only. There are NO defaults and NO
 * fallbacks: a missing or EMPTY credential makes the backend `unavailable`
 * with a stated reason, and unavailability is reported as a result rather than
 * silently dropped (BENCH-DESIGN.md rule 5).
 *
 * The empty-string check is not defensive boilerplate. Sourcing an `.env` file
 * that declares `FOO=` overwrites a perfectly good exported `FOO` with an empty
 * string, and the resulting 401 is indistinguishable from a revoked key. That
 * exact failure was observed while wiring this bench up. An empty credential is
 * missing configuration, never a credential.
 */

function cred(name) {
  const v = process.env[name];
  if (v === undefined) return { ok: false, reason: `${name} is not set` };
  const trimmed = v.replace(/[\r\n"']/g, '').trim();
  if (trimmed === '') return { ok: false, reason: `${name} is set but empty` };
  return { ok: true, value: trimmed };
}

const DEFS = [
  {
    id: 'ds-direct',
    label: 'DeepSeek V4 Flash (direct)',
    model: 'deepseek-v4-flash',
    baseEnv: null,
    baseUrl: 'https://api.deepseek.com',
    keyEnv: 'DEEPSEEK_API_KEY',
    family: 'deepseek',
    note: 'transport control A — same model family as ds-gateway, different transport',
  },
  {
    id: 'ds-gateway',
    label: 'DeepSeek V4 Flash (via gateway)',
    model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    baseEnv: 'BENCH_GATEWAY_BASE_URL',
    keyEnv: 'BENCH_GATEWAY_API_KEY',
    family: 'deepseek',
    note: 'transport control B — isolates gateway middleware from schema effects',
  },
  {
    id: 'kimi',
    label: 'Kimi K2.6 (via gateway)',
    model: 'moonshotai/Kimi-K2.6',
    baseEnv: 'BENCH_GATEWAY_BASE_URL',
    keyEnv: 'BENCH_GATEWAY_API_KEY',
    family: 'moonshot',
    note: 'reasoning-style model',
  },
  {
    id: 'minimax',
    label: 'MiniMax M2.7 (via gateway)',
    model: 'MiniMaxAI/MiniMax-M2.7',
    baseEnv: 'BENCH_GATEWAY_BASE_URL',
    keyEnv: 'BENCH_GATEWAY_API_KEY',
    family: 'minimax',
    note: 'reasoning-style model',
  },
];

function resolve() {
  return DEFS.map((d) => {
    const key = cred(d.keyEnv);
    let baseUrl = d.baseUrl || null;
    let baseReason = null;
    if (d.baseEnv) {
      const b = cred(d.baseEnv);
      if (b.ok) baseUrl = b.value.replace(/\/+$/, '');
      else baseReason = b.reason;
    }
    const problems = [];
    if (!key.ok) problems.push(key.reason);
    if (baseReason) problems.push(baseReason);
    return {
      ...d,
      baseUrl,
      apiKey: key.ok ? key.value : null,
      available: problems.length === 0,
      unavailableReason: problems.length ? problems.join('; ') : null,
    };
  });
}

/**
 * One chat completion. Returns the raw parsed body plus transport metadata.
 * Transport failures are returned, never thrown into the outcome path: the
 * caller must be able to tell "the model said nothing tool-shaped" apart from
 * "we never got a reply" (BENCH-DESIGN.md rule 2).
 */
// max_tokens was 1024 in the first run. Prompt-embedded forms spend output
// tokens on the tool-call envelope that native tools spend in a structured
// field, and reasoning models spend more still, so 1024 truncated replies and
// produced ERROR cells that clustered by form. A ceiling that interacts with
// the independent variable is a confound, not a finding.
async function chat(backend, opts) {
  // Bounded retry for TRANSPORT faults only.
  //
  // A 502 from a gateway is not evidence about the model, so letting it become
  // an ERROR cell throws away a measurement for a reason unrelated to what is
  // being measured. But retrying must never touch outcomes that ARE about the
  // model: a `finish_reason=length` reply is a real reply and is not retried
  // here, and neither is a well-formed response we simply did not like.
  //
  // Attempts are counted and returned. A retry that is not reported is hidden
  // state, and hidden state in a harness eventually becomes a wrong number.
  const MAX_ATTEMPTS = 3;
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await chatOnce(backend, opts);
    last.attempts = attempt;
    // 429 belongs here too. It is a rate limit — a fact about our request
    // pacing, not about the model's ability to drive an envelope. Leaving it out
    // (as the first version did) turns our own concurrency into an ERROR cell,
    // and ERROR cells are excluded from rates, so the missing measurement is
    // silent. Backoff is longer for 429 than for a 5xx: retrying a rate limit at
    // the same pace is how a rate limit becomes a rate-limit storm.
    const rateLimited = last.transport === 'http_error' && last.status === 429;
    const retriable =
      rateLimited ||
      last.transport === 'network_error' ||
      (last.transport === 'http_error' && typeof last.status === 'number' && last.status >= 500);
    if (!retriable || attempt === MAX_ATTEMPTS) return last;
    const base = rateLimited ? 10000 : 2000;
    await new Promise((r) => setTimeout(r, base * Math.pow(3, attempt - 1)));
  }
  return last;
}

async function chatOnce(backend, { messages, tools, maxTokens = 4096, timeoutMs = 120000 }) {
  const body = {
    model: backend.model,
    messages,
    temperature: 0,
    max_tokens: maxTokens,
  };
  if (tools) body.tools = tools;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${backend.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${backend.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { transport: 'http_error', status: res.status, raw: text.slice(0, 4000), ms: Date.now() - started };
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      return { transport: 'unparseable_body', raw: text.slice(0, 4000), ms: Date.now() - started };
    }
    return { transport: 'ok', json, raw: text, ms: Date.now() - started };
  } catch (e) {
    const kind = e.name === 'AbortError' ? 'timeout' : 'network_error';
    return { transport: kind, error: String(e && e.message), ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resolve, chat, cred };
