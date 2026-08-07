# Compatibility Matrix (v0)

**Status:** v0 — five data points, vendor-codenamed. Contributions welcome (see `../registry/`).

## How to read

Each row reports an (agent CLI family × inference backend) interaction, focused on a single question: **can the backend emit a `tool_call` that the agent executes?**

- **Tool-exposure protocol** — how the agent advertises its tools to the backend
- **Adapter** — what sits between agent and backend (`direct` = none)
- **Emits tool_call** — whether the backend emits a `tool_call` the agent accepts
- **Executes** — whether a tool side effect is observed (e.g., a file is written)
- **Status** — `compatible` / `dialog-only` / `compatible (bridged)`
- **Evidence** — strength of the observation:
  - `observed` — reproduced directly by us
  - `observed*` — protocol layer verified by a deterministic mock suite; end-to-end via a real gateway verified by the install-time self-test
  - `documented` — asserted by the project's source/architecture; **not** independently reproduced end-to-end by us

## Matrix

| # | Agent CLI (codename) | Tool-exposure protocol | Backend | Adapter | Emits tool_call | Executes | Status | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | Vendor A (function-tool-style) | Standard function-tool schema (Messages-style) | DeepSeek | direct | ✅ | ✅ (file written) | compatible | observed |
| 2 | Vendor A (function-tool-style) | Standard function-tool schema | Self-hosted OpenAI-compatible gateway, **non-standard path prefix** | path-rewrite proxy | ✅ | ✅ | compatible | observed* |
| 3 | Vendor B (rpc-wrapping-style) | Connect-RPC / Protobuf-wrapped (Responses-style) | DeepSeek | direct | ❌ | ❌ (advisory text only) | dialog-only | observed |
| 4 | Vendor B (rpc-wrapping-style) | Connect-RPC / Protobuf-wrapped | Self-hosted OpenAI-compatible gateway | protocol bridge (Responses→Chat) | ✅ | ✅ | compatible (bridged) | observed |
| 5 | Vendor C (function-tool-style, **native multi-backend**) | Standard function-tool schema (OpenAI-compatible) | DeepSeek / OpenAI / OpenRouter / Ollama / vLLM / SGLang / … | direct | ✅ | ✅ | compatible | documented |

## Notes

- **Row 1 (Vendor A → DeepSeek, direct)** — the backend receives a standard tool schema, emits a `tool_call`, and the agent executes it. File-creation side effect observed on first run (sandbox/write permissions configured).
- **Row 2 (Vendor A → self-hosted gateway, via path-rewrite proxy)** — the *only* obstacle to driving a Family A agent from a self-hosted OpenAI-compatible gateway was **transport**, not tool-use: many enterprise gateways expose the OpenAI surface under a **non-standard path prefix** (e.g. `/v1/model/chat/completions`), so a translator hardcoding `/v1/chat/completions` gets a 500/404 masquerading as "provider not found". A thin path-rewrite + Anthropic↔Chat translation proxy closes the gap. This confirms the SPEC's claim that attaching a Family A client to an arbitrary capable backend is a pure engineering problem. Reference implementation: [`../reference/path-rewrite-proxy/`](../reference/path-rewrite-proxy/) (28/28 deterministic structural assertions on tool translation + streaming SSE).
- **Row 3 (Vendor B → DeepSeek, direct)** — the backend returns a single ~1.9 s text response *describing* the action ("you could run `echo … > file`") but performs **no** action and emits **no** `tool_call`. Dialog works; tool execution does not. See `../analysis/01-function-vs-rpc-wrapping.md`.
- **Row 4 (Vendor B → gateway, via protocol bridge)** — a Family B agent *can* be made drivable, but only by bridging its proprietary protocol: an external adapter translates the Responses-style surface to standard Chat Completions (and normalizes non-standard roles such as `developer`→`system`). This is the "bridging a protocol gap" path SPEC §6 defers — materially more complex than Row 2's transport-only fix, and it depends on a third-party bridge binary.
- **Row 5 (Vendor C, native multi-backend)** — the limiting case of Family A: an agent whose entire client is provider-agnostic by construction (a single tool-use interface over a standard function-tool schema, with a backend registry spanning managed and self-hosted OpenAI-compatible endpoints). Drivability is a design property, not an adapter add-on. Marked `documented` because it is read from the project's architecture and provider table, not independently reproduced end-to-end across every listed backend by us.

## Codename policy

Vendor identities are codenamed by policy (see `../DISCLAIMER.md`). Backends are named where they are the *test substrate*, not the object of any circumvention (e.g. DeepSeek). "Self-hosted OpenAI-compatible gateway" denotes a generic, placeholder-configured upstream — no real host or credential is referenced.

## Methodology note

Observations were made through each CLI's non-interactive (`-p` / `--print` or equivalent) mode with write tooling explicitly enabled (sandbox disabled, write/approve flags set), isolating the tool-use question from permissions.

## Contributing

Reports for additional (CLI, backend) pairs belong in `../registry/`. Reports must describe observed behavior only — no runnable patches or bypass code.
