# Related Work & Positioning

This project did not invent the observation that agent tool interfaces vary by vendor — it
gives that observation a **concrete taxonomy and a drivability criterion** for the specific
case of coding-agent CLIs. This note places the work on the map of existing agent-
interoperability and harness-engineering literature, and states honestly what it does and
does **not** add.

The one-line position: **tool-exposure schema is the layer that decides whether a
third-party backend can drive an agent's tools — and it is a *precondition* that the
surrounding literature either standardizes away (MCP/A2A) or assumes given (NLAH),
rather than studies as an empirical property of shipped agent CLIs.**

## 1. The interoperability landscape

Agent interoperability is usually discussed along two axes. This work isolates a third.

| Axis | What it standardizes | Representative framing |
|---|---|---|
| Agent ↔ external tools/resources | How an LLM discovers and calls capabilities outside itself | **MCP** — Model Context Protocol |
| Agent ↔ agent | How two independently-built agents talk and delegate | **A2A** — Agent2Agent, `Agent Card` as capability identity |
| **Backend ↔ the agent's own tools** *(this work)* | **Whether a given inference backend can emit a `tool_call` the agent actually executes** | Family A / Family B taxonomy + drivability criterion |

**MCP** (*Agentic Design Patterns*, Ch. 10) draws exactly the distinction this project
depends on. It contrasts **tool function calling** — *"Proprietary and vendor-specific. The
format and implementation differ across LLM providers"* — against MCP as *"an open,
standardized protocol, promoting interoperability between different LLMs and tools."*
Our Family A vs Family B split is the coding-agent-CLI-level consequence of precisely
that "proprietary and vendor-specific" reality: Family A ships a standard function-tool
schema any backend can emit against; Family B wraps its tools in a private RPC/Protobuf
transport, so only its own backend can drive them. MCP is the *prescription*
(standardize the interface); this work is the *diagnosis* (measure which shipped CLIs are
already drivable, and by what).

**A2A** (*Agentic Design Patterns*, Ch. 15) standardizes agent-to-agent interaction via an
`Agent Card` (a JSON capability/identity descriptor) and treats a remote agent as an
*"opaque"* HTTP endpoint whose internals the client need not understand. That opacity is
the same property that makes a Family B agent undrivable from a standard backend — but
A2A operates one level up (agent ↔ agent), whereas this work operates at backend ↔
one agent's tool loop. The two are complementary, not overlapping.

> Source: *Agentic Design Patterns* (Antonio Gulli, Google), Ch. 10 (MCP) and Ch. 15
> (Inter-Agent Communication / A2A). Cited as a consensus framing anchor, not a claim
> of novelty by that text.

## 2. Natural-Language Agent Harnesses (NLAH) — the portability precondition

**NLAH** (Pan et al., Tsinghua SIGS, arXiv:2603.25723) asks whether the *high-level control
logic of a harness* — contracts, roles, stage structure, adapters, state semantics, failure
taxonomy — can be externalized as a portable, executable natural-language object and run
under a shared runtime (the Intelligent Harness Runtime, IHR).

This is a **different question** from ours, and the relationship is best stated precisely
rather than as "nearest neighbor":

- NLAH's framework diagram places the **backend / tool interface / agent calls** as a
  *given substrate* of the runtime — a layer the portable harness is executed *on top of*.
- **This work is a magnifying glass on exactly that assumed-given layer.** Portable harness
  text is necessary but not sufficient: if the target runtime's agent is Family B, a
  third-party backend cannot emit a `tool_call` its loop recognizes, and the portable
  harness has nothing to stand on. Tool-exposure drivability is therefore a **precondition**
  of the NLAH portability story, not a competitor to it.

Notably, NLAH's own *Limitations* section concedes this blind spot:

> "some harness mechanisms cannot be recovered faithfully from text, especially when
> they rely on hidden service-side state, **proprietary schedulers**, or training-induced
> behaviors not observable from released artifacts."

A Family B RPC-wrapped tool loop *is* such a proprietary scheduler. This project studies
the boundary NLAH explicitly brackets out.

> Source: NLAH, arXiv:2603.25723 — §2.3 (harness components), Fig. 2 (framework
> overview), and §Limitations.

## 3. Harness-as-program and harness synthesis (adjacent, orthogonal)

A line of work treats prompts/harnesses as programmable or synthesizable objects:
prompts-as-programs and promptware engineering (Liang et al. 2025; Chen et al. 2026),
declarative LM pipelines (DSPy, Khattab et al. 2024), and automatic harness synthesis
(**AutoHarness**, Lou et al. 2026, which *generates* code harnesses as an optimization
target). This project is orthogonal to all of them: it neither programs the call pipeline nor
synthesizes a harness. It **classifies an existing property** of shipped agent CLIs — the
schema by which they expose tools — and derives a drivability criterion from it. A synthesized
or programmed harness still inherits its target CLI's Family A/B status.

## 4. What this work does *not* claim

- **Not** that Family B agents are "broken" — they work with their own backend; they are
  simply not drivable by an arbitrary standard backend without a protocol bridge.
- **Not** a novel protocol. MCP/A2A already prescribe standardized interfaces; this work
  measures the *current* landscape of shipped CLIs, most of which predate or ignore those
  standards for their internal tool loop.
- **Not** a superset or subset of NLAH. It is the precondition layer NLAH assumes given.
- **Not** a completed wire protocol or conformance suite — see [`SPEC.md`](SPEC.md) §6–7.

---

*Sources are cited inline. NLAH claims are drawn from the arXiv paper read first-hand;
Agentic Design Patterns framing is quoted from Ch. 10 / Ch. 15. All other statements are
this project's own analysis (see [`analysis/01-function-vs-rpc-wrapping.md`](analysis/01-function-vs-rpc-wrapping.md)).*
