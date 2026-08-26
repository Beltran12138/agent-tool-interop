# agent-tool-interop

**An interoperability research initiative for AI coding-agent tool-use interfaces.**

This project studies how different AI coding-agent CLIs expose their tool-use interfaces to inference backends, documents the resulting compatibility landscape, proposes a vendor-neutral interface contract, and ships a small reference implementation that demonstrates the contract. It is **research and documentation**, with one vendor-neutral reference adapter — not a bypass tool.

## What this is

- A **protocol analysis** of how agent CLIs advertise tools to backends, and why some are drivable by third-party backends while others are not.
- An **interface specification** ([`SPEC.md`](SPEC.md), v0 draft) defining what it means for an agent CLI to be tool-use interoperable.
- A **compatibility matrix** documenting observed (agent, backend) behavior.
- A **reference implementation** ([`reference/path-rewrite-proxy/`](reference/path-rewrite-proxy/)) — a vendor-neutral proxy showing that a Family A client attaches to an arbitrary OpenAI-compatible gateway through pure transport/protocol adaptation.
- A **registry** structure for community interoperability reports.
- A **positioning note** ([`RELATED-WORK.md`](RELATED-WORK.md)) placing the taxonomy against MCP / A2A / **ACP** and Natural-Language Agent Harnesses (NLAH) — where tool-exposure drivability sits as a precondition the surrounding literature standardizes away or assumes given. ACP is the nearest neighbour: it standardizes the *client* boundary (sessions, streaming, tool-call **approval**) and leaves the *backend* boundary — the one measured here — untouched.

## What this is *not*

- **Not** a tool to connect a specific backend to a specific agent.
- **Not** a source of vendor-specific bypass patches or binaries.
- **Not** affiliated with or endorsed by any vendor.

See [`DISCLAIMER.md`](DISCLAIMER.md).

## At a glance

| Artifact | Status | File |
|---|---|---|
| Interface specification | v0 draft | [`SPEC.md`](SPEC.md) |
| Compatibility matrix | v0 (5 data points) | [`matrix/compatibility.md`](matrix/compatibility.md) |
| Protocol analysis | #1: function tools vs RPC-wrapping | [`analysis/01-function-vs-rpc-wrapping.md`](analysis/01-function-vs-rpc-wrapping.md) |
| Reference implementation | path-rewrite proxy — 28/28 tests | [`reference/path-rewrite-proxy/`](reference/path-rewrite-proxy/) |
| Conformance bench — design | measurement design, written before the code | [`docs/BENCH-DESIGN.md`](docs/BENCH-DESIGN.md) |
| Measurement discipline | **15 rules, each with the run that produced the wrong number** | [`docs/MEASUREMENT-DISCIPLINE.md`](docs/MEASUREMENT-DISCIPLINE.md) |
| Conformance bench — harness | 4 backends × 3 exposure forms, 72 offline assertions | [`bench/`](bench/) |
| Conformance bench — Slice 0 | saturated at ceiling; three false-result mechanisms closed | [`bench/FINDINGS-SLICE0.md`](bench/FINDINGS-SLICE0.md) |
| Conformance bench — Slice 0.1 | 116 cells — envelopes equally drivable, unequally demanding (**one claim since retracted**) | [`bench/FINDINGS-SLICE0.1.md`](bench/FINDINGS-SLICE0.1.md) |
| Conformance bench — Slice 0.2 | 148 cells, strict scoring — the forms finally separate | [`bench/FINDINGS-SLICE0.2.md`](bench/FINDINGS-SLICE0.2.md) |
| Conformance bench — Slice 0.3 | dialect swap — the XML deficit was a spec/prior mismatch | [`bench/FINDINGS-SLICE0.3.md`](bench/FINDINGS-SLICE0.3.md) |
| Conformance bench — Slice 0.4 | **contamination 2×2 — the mirror test failed; a dialect prior survives with no tool protocol at all** | [`bench/FINDINGS-SLICE0.4.md`](bench/FINDINGS-SLICE0.4.md) |
| Community registry | placeholder | [`registry/`](registry/) |

## Key finding

Whether an inference backend can drive a coding agent's tools is determined primarily by **how the agent exposes its tools**, not by backend capability. Agents using a standard function-tool schema are drivable; agents wrapping tools in proprietary RPC/Protobuf protocols are not — the backend returns advisory text instead of performing actions. See [Analysis 01](analysis/01-function-vs-rpc-wrapping.md).

**Corollary (demonstrated by the reference implementation):** when the client *is* Family A, attaching it to a self-hosted gateway is a **transport** problem (path-prefix rewrite + protocol translation), not a tool-use problem. A thin proxy closes the gap; see matrix rows 2 and 4 for the Family A vs Family B contrast.

## Repo structure

```
agent-tool-interop/
├── README.md
├── LICENSE                 # MIT
├── DISCLAIMER.md
├── RELATED-WORK.md         # positioning vs MCP / A2A / NLAH
├── SPEC.md                 # v0 interface contract
├── matrix/
│   └── compatibility.md    # observed (agent, backend) data — 5 points
├── analysis/
│   └── 01-function-vs-rpc-wrapping.md
├── docs/
│   ├── BENCH-DESIGN.md            # conformance bench: measurement design, pre-implementation
│   └── MEASUREMENT-DISCIPLINE.md  # what went wrong, and the rule each failure earned
├── bench/                  # the harness + Slice 0 results + every raw trace
├── reference/
│   └── path-rewrite-proxy/ # vendor-neutral proxy (Family A → OpenAI-compatible gateway)
└── registry/
    └── README.md           # community report structure (placeholder)
```

## Limitations

- v0 is a **category definition and criterion**, not a complete wire protocol or conformance test suite.
- The matrix has five data points (a mix of directly observed and architecture-documented); broader coverage depends on community reports.
- The reference implementation demonstrates the **Family A → gateway** path (transport adaptation). A full backend-relay reference for the Family B bridging path (track `β`) remains future work, gated on v0 traction.
- The conformance bench measures a deliberately different half of the problem from Analysis 01 — the backend's ability to emit against a given exposure form, rather than a shipped CLI's exposure form itself. That scope shift is stated in [`docs/BENCH-DESIGN.md`](docs/BENCH-DESIGN.md) §1.1 rather than elided.
- **Binary drivability saturated twice under a lenient parser** (Slice 0, then Slice 0.1 at higher difficulty). Making conformance part of the outcome — scoring under a scaffold that accepts only the syntax it specified — is what finally separated the forms: **native 0.96, prompt-JSON 1.00, prompt-XML 0.74**, where a lenient consumer would have reported the XML form at 0.93 and seen none of it. The whole XML deficit is one model. See [`bench/FINDINGS-SLICE0.2.md`](bench/FINDINGS-SLICE0.2.md).
- **That XML deficit has since been reinterpreted, not retracted.** Re-running the same form with the *other* XML dialect specified (Slice 0.3) took the deviant model from 0.00 to 0.60 with nothing changed but the tags the prompt asked for — and cost two other backends a cell each, leaving the aggregate flat. Prompt-embedded XML has no canonical dialect, so whichever one a scaffold specifies mismatches someone's post-training prior. The number was a property of the **ecosystem**, not of the envelope.
- **A prompt-embedded envelope can have its control syntax displaced by syntax appearing in its data — narrowly.** One backend, with no measurable dialect prior, wrote a payload containing the other XML dialect, read it back, and emitted its next tool call in that dialect: parse fine, task fine, only the syntax moved. It replicated exactly across two runs a day apart. A native schema cannot do this, because the call never shares a channel with the content. But the mirror test failed — a payload in the *other* dialect pulled nobody — so the effect is **asymmetric and not a general property of prompt-embedded forms**, which is how [`bench/FINDINGS-SLICE0.3.md`](bench/FINDINGS-SLICE0.3.md) first stated it. See [`bench/FINDINGS-SLICE0.4.md`](bench/FINDINGS-SLICE0.4.md).
- **A model's dialect prior survives the removal of the entire tool protocol.** Asked to reproduce five lines of literal text with no tools and no envelope, one model silently rewrote them into its own dialect and failed the copy. So the prior is a text-level phenomenon, and two unlike things had been pooled: one model was using the other dialect *everywhere*, another only on the payload task. Same flag, two constructs — pooled, they made the evidence look twice as strong as it was.
- **One Slice 0.1 headline has been retracted.** "Parallelism appeared only in the native form" was a parser artifact: the parser read the first tool call in a message and silently dropped the rest, and the contradicting evidence was already on disk in that same run. A silent drop does not only lose data — it manufactures the opposite finding, in the direction the analyst expects.
- The findings files list every harness defect found while running, because each would otherwise have produced a confident wrong number: a parallel-call bug that 400'd the native form on exactly the task where its advantage shows, a classifier that inverted the `F0`/`F2` distinction it exists to enforce, assertions appended after `process.exit` that could never fail, and a syntax failure reported as a reasoning failure.

## License

MIT — see [`LICENSE`](LICENSE).
