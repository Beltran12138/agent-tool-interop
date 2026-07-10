# Compatibility Matrix (v0)

**Status:** v0 — two observed data points, vendor-codenamed. Contributions welcome (see `../registry/`).

## How to read

Each row reports an **observed** (agent CLI family × inference backend) interaction, focused on a single question: **can the backend emit a `tool_call` that the agent executes?**

- **Tool-exposure protocol** — how the agent advertises its tools to the backend
- **Emits tool_call** — whether the backend emits a `tool_call` the agent accepts
- **Executes (side effect)** — whether a tool side effect is observed (e.g., a file is written)
- **Status** — `compatible` / `dialog-only`

## Matrix

| Agent CLI (codename) | Tool-exposure protocol | Backend | Emits tool_call | Executes (side effect) | Status |
|---|---|---|---|---|---|
| Vendor A (function-tool-style) | Standard function-tool schema | DeepSeek | ✅ | ✅ (file written) | compatible |
| Vendor B (rpc-wrapping-style) | Connect-RPC / Protobuf-wrapped | DeepSeek | ❌ | ❌ (advisory text only) | dialog-only |

## Notes

- **Vendor A** — the backend receives a standard tool schema, emits a `tool_call`, and the agent executes it. A file-creation side effect was observed on first run (with sandbox/write permissions configured).
- **Vendor B** — the backend returns a single text response (~1.9 s) containing an *advisory* description of the action (e.g., "you could run `echo … > file`") but performs **no** action and emits **no** `tool_call`. Dialog works; tool execution does not. See `../analysis/01-function-vs-rpc-wrapping.md`.

## Methodology note

Observations were made through each CLI's non-interactive (`-p` / `--print` or equivalent) mode with write tooling explicitly enabled (sandbox disabled, write/approve flags set), isolating the tool-use question from permissions. Vendor identity is codenamed by policy (see `../DISCLAIMER.md`).

## Contributing

Reports for additional (CLI, backend) pairs belong in `../registry/`. Reports must describe observed behavior only — no runnable patches or bypass code.
