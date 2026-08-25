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
| Client/editor ↔ agent | How an editor opens a session, streams updates, and **approves** an agent's tool calls | **ACP** — Agent Client Protocol |
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
> of novelty by that text. MCP's published specification is date-versioned; the current
> revision at the time of writing is `2026-07-28`.

## 2. ACP — the nearest neighbour, and why it is a different axis

**ACP** (Agent Client Protocol, `zed-industries/agent-client-protocol`, Apache-2.0)
"standardizes communication between code editors/IDEs and coding agents," over JSON-RPC 2.0.
It has been adopted well beyond its origin: JetBrains IDEs, Neovim (`avante.nvim`) and Zed all
drive agents through it, and the agents reachable this way include ones this taxonomy
classifies as **Family B**.

That makes ACP the strongest test the Family A/B distinction has faced. **The distinction
survives — but the reason is specific, and stating it precisely matters more than the
conclusion.**

ACP standardizes the **client** boundary: session lifecycle, streamed updates, and tool-call
**approval**. It does not standardize the **backend** boundary. Taking Cursor CLI's ACP mode
as a worked example (`agent acp`, newline-delimited JSON-RPC over stdio):

- The client's `initialize` advertises `clientCapabilities` covering `fs`
  (`readTextFile` / `writeTextFile`) and `terminal` — **filesystem and terminal, not
  inference**. There is no field through which a client supplies a model or an inference
  endpoint.
- `authenticate` takes `methodId: "cursor_login"`. Credentials are the vendor's own
  (`CURSOR_API_KEY` / `CURSOR_AUTH_TOKEN`), against the vendor's own endpoint.
- The client meets tool calls only at the *approval* boundary — `session/request_permission`,
  answered `allow-once` / `allow-always` / `reject-once`. The client **observes and gates**
  tool calls; it never **emits** one.
- Tellingly, the `cursor/task` extension carries an optional `model` field, sent as a
  fire-and-forget notification. Model identity is **reported** to the client, not **selected**
  by it.

Zed's own documentation states the division plainly: an External Agent "owns its own runtime,
auth, model selection, tools, and native configuration," and model/provider configuration is
"usually owned by the External Agent."

So, under ACP: **any editor can drive the agent; still only the vendor's backend can drive the
agent's tools.** ACP relocates the opacity rather than removing it, and the boundary it leaves
closed is precisely the one this project measures.

Two amendments this project owes ACP:

1. **The "proprietary and opaque" framing must be narrowed.** A Family B agent's session and
   permission surface is now open, documented and JSON-RPC. `analysis/01` should be read as
   scoped to the *backend* boundary alone; it is no longer a claim about the agent as a whole.
2. **A new data point, pointing the other way.** An open protocol does not end vendor-private
   surface: Cursor layers five `cursor/*` extension methods on top of ACP, two of them
   *blocking* (`cursor/ask_question`, `cursor/create_plan`) — "if your client does not answer
   permission requests, tool execution can block." A client that ignores them stalls the
   agent. Vendor-specific behaviour reappears **as extensions above the standard** — the same
   shape as Family B's RPC wrapping, one layer up. Standardization moves the interop question;
   it does not retire it.

> ⚠️ **Naming collision.** Three unrelated protocols ship as "ACP": the Agent **Client**
> Protocol (this section), IBM/BeeAI's Agent **Communication** Protocol (folded into A2A under
> the Linux Foundation and wound down), and the Agentic **Commerce** Protocol (OpenAI/Stripe).
> This document always means the first.
>
> Sources: `agentclientprotocol.com` (scope), `zed.dev/docs/ai/external-agents` (ownership
> split), `cursor.com/docs/cli/acp` (the ACP-mode details quoted above), and the protocol
> repository's own metadata. All read first-hand.

## 3. Empirical corroboration from the model side (Qwen3-Coder-Next)

This project argues drivability is a property of the agent's tool-exposure schema. A frontier
model report arrives at the same fragmentation from the opposite end — the model's — and is
worth citing precisely because it was not written to support this thesis.

The **Qwen3-Coder-Next Technical Report** (arXiv:2603.00729) names the phenomenon directly:

> "Many existing models are trained with a single tool chat template, which often leads to
> overfitting to specific output structures and reduced robustness when deployed under unseen
> tool-calling formats."

and attributes it to shipped scaffolds — Cline, Qoder, OpenCode, Claude Code and KiloCode are
named as "adopting customized prompt templates together with distinct function-calling and MCP
interaction formats." Its appendix enumerates **21 distinct tool chat templates** used in
training, and it reports scaffold-to-scaffold generalization as a headline result.

Two things follow, and they cut in opposite directions:

- **Against this project's novelty:** the *existence* of tool-schema fragmentation is
  established by a party with far more data than this repository has. Analysis 01's
  contribution is the **drivability criterion** built on top of it, not the observation itself.
- **In this project's favour, and this is the open slot:** Qwen's *published* evaluation code
  (`qwencoder-eval/tool_calling_eval`) wraps **τ-bench and BFCL-v3** and invokes them with a
  single `--agent-strategy tool-calling` against an OpenAI-compatible endpoint. That measures
  *whether a model can call functions*. It does **not** hold a task fixed and vary the
  tool-call schema. The 21 templates appear as a training-side inventory, not as a released
  portability benchmark.

**Schema portability — same task, same backend, differing only in how tools are exposed —
therefore remains unmeasured in public.** That is the natural v1 of `SPEC.md` §6's deferred
conformance suite.

> Confidence note: the quotations are read first-hand from the paper's full text; the
> evaluation-code claim is read first-hand from the repository tree and the runner scripts.
> "Unmeasured in public" is a negative result from a bounded search — absence of evidence, and
> stated as such.

## 4. Natural-Language Agent Harnesses (NLAH) — the portability precondition

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

## 5. Harness-as-program and harness synthesis (adjacent, orthogonal)

A line of work treats prompts/harnesses as programmable or synthesizable objects:
prompts-as-programs and promptware engineering (Liang et al. 2025; Chen et al. 2026),
declarative LM pipelines (DSPy, Khattab et al. 2024), and automatic harness synthesis
(**AutoHarness**, Lou et al. 2026, which *generates* code harnesses as an optimization
target). This project is orthogonal to all of them: it neither programs the call pipeline nor
synthesizes a harness. It **classifies an existing property** of shipped agent CLIs — the
schema by which they expose tools — and derives a drivability criterion from it. A synthesized
or programmed harness still inherits its target CLI's Family A/B status.

## 6. What this work does *not* claim

- **Not** that Family B agents are "broken" — they work with their own backend; they are
  simply not drivable by an arbitrary standard backend without a protocol bridge.
- **Not** that Family B agents are closed *in general*. Since ACP, several expose an open,
  documented session and permission surface. The closure this project measures is at the
  backend boundary only (§2).
- **Not** a competitor to ACP, and not a claim that ACP failed at something. ACP standardizes
  a different boundary and standardizes it well; the backend boundary is simply outside its
  scope.
- **Not** the discovery of tool-schema fragmentation, which is independently documented from
  the model-training side with more data (§3). The contribution is the drivability criterion
  and the matrix, not the observation.
- **Not** a novel protocol. MCP/A2A already prescribe standardized interfaces; this work
  measures the *current* landscape of shipped CLIs, most of which predate or ignore those
  standards for their internal tool loop.
- **Not** a superset or subset of NLAH. It is the precondition layer NLAH assumes given.
- **Not** a completed wire protocol or conformance suite — see [`SPEC.md`](SPEC.md) §6–7.

---

*Sources are cited inline. NLAH and Qwen3-Coder-Next claims are drawn from the arXiv papers
read first-hand; ACP claims from the protocol, editor and vendor documentation read
first-hand; Agentic Design Patterns framing is quoted from Ch. 10 / Ch. 15. All other
statements are this project's own analysis (see
[`analysis/01-function-vs-rpc-wrapping.md`](analysis/01-function-vs-rpc-wrapping.md)).*
