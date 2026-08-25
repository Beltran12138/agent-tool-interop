# Agent Tool-Use Interoperability Specification

**Status:** v0 (draft) — defines the category and a compatibility criterion. Not yet a complete wire protocol.

## 1. Motivation

AI coding agents expose a set of tools (file write, shell, search, …) that an inference backend (the model) invokes to act on the world. The mechanism by which an agent exposes these tools to the backend — and by which the backend invokes them — varies across implementations. Some use widely-supported open schemas; others wrap tool definitions in proprietary protocols. **This variance determines whether a given backend can actually drive a given agent's tools.**

This specification defines what it means for an agent CLI to be **tool-use interoperable** with third-party inference backends.

## 2. Scope

**In scope:**
- How an agent CLI advertises its available tools to an inference backend
- How the backend invokes a tool (`tool_call`) and how the agent returns the outcome (`tool_result`)
- A conformance criterion for interoperability with backends that speak a standard tool schema

**Out of scope:**
- Authentication, billing, and transport (independent of tool-use interop)
- Any specific vendor's proprietary protocol (referenced by codename only)
- Tool *semantics* (what a tool does); only the *interface contract* matters here

## 3. Core concept

**Tool-use interoperability** = a backend that conforms to a standard tool schema can discover the agent's tools, emit `tool_call`s for them, and receive `tool_result`s back, **without the agent requiring the backend to speak a proprietary protocol**.

## 4. The contract (v0)

An agent CLI is **tool-use interoperable** iff it exposes its tools to inference backends via a **standard function-tool schema** — a tool description format that mainstream inference backends can parse and emit without vendor-specific wrapping.

Concretely, a conformant agent CLI must:

1. **Advertise** its available tools as standard function/tool definitions in the request it sends to the backend.
2. **Accept** standard `tool_call` messages emitted by the backend and execute the referenced tool.
3. **Return** the outcome as a standard `tool_result` message in the next turn.

A backend that, under this standard schema, can emit a well-formed `tool_call` that the agent accepts and executes is said to **drive** the agent's tools.

## 5. Compatibility criterion

For a given (agent CLI, backend) pair:

- **Compatible** — the backend, receiving the agent's standard tool schema, emits `tool_call`s the agent executes (observed: tool side effects occur).
- **Dialog-only / incompatible** — the backend returns only text; no `tool_call` is emitted or none is executed (observed: no tool side effects; responses are advisory text rather than actions).

The failure mode of interest: the agent wraps its tools in a protocol the backend cannot speak, so the backend — even if capable of tool use — never emits a `tool_call` the agent recognizes. The agent then returns a *textual description* of the action rather than performing it. (See `analysis/01-function-vs-rpc-wrapping.md`.)

## 6. Non-goals (v0)

- A complete wire protocol (deferred; v0 fixes the interface *shape*, not bytes).
- A conformance test suite (planned for a later version; the measurement design is drafted in [`docs/BENCH-DESIGN.md`](docs/BENCH-DESIGN.md), which also records what result would falsify it).
- Tool-result streaming / partial outputs.

## 7. Status

v0 is a **category definition + compatibility criterion**. It is the contractual basis on which a future reference implementation (track `β`) and conformance test suite may be built. It intentionally underspecifies to avoid premature commitment before more CLI families are surveyed.
