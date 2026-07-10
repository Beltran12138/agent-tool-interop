# Why an LLM backend can drive some coding agents but not others

*Analysis 01 — function tools vs RPC-wrapped tool schemas*

## TL;DR

Whether an inference backend can *drive* a coding agent's tools is determined less by the backend's capability than by **how the agent exposes its tools**. Agents that advertise tools via a **standard function-tool schema** are drivable; agents that wrap their tools in a **proprietary RPC/Protobuf protocol** are not — the backend never emits a `tool_call` the agent recognizes, and returns advisory text instead.

## The two families

### Family A — function-tool-style

The agent describes its tools using a **standard function/tool schema** — the same shape mainstream inference backends already parse and emit. The exchange is:

1. Agent → backend: request including standard tool definitions
2. Backend → agent: a `tool_call` referencing one of those tools
3. Agent: executes the tool, returns a `tool_result`
4. (loop)

Because the tool schema is standard, **any backend that supports tool use can drive the agent**, including third-party and self-hosted backends.

### Family B — rpc-wrapping-style

The agent wraps its tool protocol in a **proprietary bidirectional-stream RPC (Connect-RPC / Protobuf)**. The agent's internal loop speaks this private protocol. A third-party backend — even one fully capable of tool use — sees either:

- a request whose tool definitions are **not** in a standard schema it can emit against, or
- a transport it cannot speak,

and therefore **never emits a `tool_call` the agent recognizes**.

## Observed behavior (same backend, same task)

Same inference backend (DeepSeek), same task ("create a file containing X"):

| | Family A | Family B |
|---|---|---|
| API round-trips | multiple (agent loop) | **single** (~1.9 s) |
| Response content | `tool_call` → file written | advisory text ("you could run `echo …`") |
| `tool_use` block in response | present | **absent** |
| Side effect (file created) | ✅ | ❌ |

Family B returns a **plausible-looking completion** that *describes* the action without *performing* it. To a casual reader the agent "answered" the task; objectively, nothing happened. The single ~1.9 s round-trip (vs. a multi-turn agent loop) is the tell-tale signature: no tool was invoked.

## Why this matters

The implication is **not** "Family B is broken" or "the backend is incapable." It is that **tool-use interoperability is a property of the agent's exposure schema**: an agent that hides its tools behind a proprietary protocol is — by construction — not drivable by standard backends, however capable those backends are.

This reframes the question from *"can we patch backend X into agent Y"* to *"which agents expose a drivable tool interface in the first place."* The latter has a stable, surveyable answer; the former is a per-version cat-and-mouse.

## What this analysis is *not*

- It is **not** a guide to patching any specific agent. No runnable code is provided.
- It does **not** claim Family B cannot be made drivable — only that doing so requires bridging a protocol gap, which is out of scope here (see `../SPEC.md` §6) and may carry its own risks.
- Vendors are referred to by family / codename, not trademark.

## See also

- [`../SPEC.md`](../SPEC.md) — the interface contract and compatibility criterion
- [`../matrix/compatibility.md`](../matrix/compatibility.md) — the observed data points
