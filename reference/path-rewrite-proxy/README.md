# path-rewrite-proxy

> Reference implementation for the [agent-tool-interop](../../README.md) research initiative.
> A thin, zero-dependency Node.js proxy that lets a **Family A** agent CLI (one that speaks
> standard function-tool schemas, e.g. Claude Code / Codex) drive an OpenAI-compatible backend
> that lives behind a **non-standard path prefix**.

## Why this exists

Generic Anthropic↔OpenAI translation layers hardcode the upstream path `/v1/chat/completions`.
Many self-hosted / enterprise gateways instead expose the OpenAI surface under a **non-standard
prefix** (e.g. `/v1/model/chat/completions`, as some Zhipu/GLM-style gateways do). Pointing a
translator straight at such a gateway yields a `500`/`404` that masquerades as *"provider not
found"* — the request never reaches a model.

This proxy closes that gap. It is the smallest thing that makes "attach a Family A client to an
arbitrary OpenAI-compatible gateway" a **pure engineering problem** — which is exactly the claim
the [SPEC](../../SPEC.md) makes about Family A clients: because they advertise/accept/return tools
via standard function-tool schemas, driving them from any capable backend requires only transport
adaptation, never a protocol reverse-engineering fight.

## What it does

Two entry points on one local port (`127.0.0.1:8423` by default):

| Entry | Route | Behaviour |
|---|---|---|
| **A — passthrough** (Codex/ccx & other OpenAI clients) | `/v1/chat/completions`, `/v1/embeddings`, `/v1/models` | Rewrites the path prefix (`/v1/X` → `${GATEWAY_PATH_PREFIX}/X`), injects the real `Bearer` key, optional `model` rewrite. Streams SSE byte-for-byte. |
| **B — translate** (Claude Code & other Anthropic clients) | `/v1/messages`, `/v1/messages/count_tokens` | Full Anthropic Messages → OpenAI Chat translation (system, `tool_use`/`tool_result`, `tools`/`tool_choice`) and back (non-streaming JSON + streaming SSE event sequence). No external translation layer needed. |
| probe | `GET /v1/proxy-info` | Capability probe used by install scripts to detect an already-running translating build. |

The real Bearer key lives **only** in this process's environment — never on disk in client
config, never logged.

## Usage

```bash
cp .env.example .env          # fill GATEWAY_BASE_URL, GATEWAY_API_KEY, (optional) GATEWAY_MODEL
node proxy.js                 # or: npm start
```

Point your agent at `http://127.0.0.1:8423`:
- Claude Code: `ANTHROPIC_BASE_URL=http://127.0.0.1:8423` + any non-empty auth token.
- OpenAI clients: use it as the OpenAI base URL.

`install-proxy.sh` is an optional macOS one-shot installer (launchd auto-start + crash restart +
idempotent re-runs). It is provided as an operational example, not a dependency.

## Tests

```bash
npm test          # node test-anthropic-mock.js
```

Deterministic structural assertions against a mock upstream: path rewrite, tools/`tool_use`/
`tool_result` translation, non-streaming round-trip, and the full streaming SSE event sequence
(`message_start` … `content_block_delta` … `message_stop`), plus usage mapping.

## Limitations

- Anthropic `image` blocks in user turns are dropped (many chat backends reject them).
- `model` rewrite is single-value (`GATEWAY_MODEL`) or a per-name map (`MODEL_REWRITE_MAP`);
  empty = passthrough the original model.
- macOS installer only; the proxy itself (`proxy.js`) is platform-agnostic Node ≥18.

## Note on desensitization

This is a vendor-neutral reference. All gateway hosts, models, and credentials are placeholders
(`your-gateway.internal`, `GATEWAY_*` env). It ships **no** real endpoint, key, or internal
address, and is not affiliated with any vendor.
