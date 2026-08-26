# Slice 0.4 — the contamination 2×2

Run `2026-08-26T03-34-05-263Z`. 4 backends × 2 exposure forms (`S4`, `S4b`) × 4 tasks
(`T1`, `T7`, `T8`, `T8b`), 3 positive controls per (backend, form), an `S0` no-tools baseline
per (backend, task), `MAX_TURNS=10`. 32 grid cells. Traces under `runs/`.

Pre-registered in [`../docs/BENCH-DESIGN.md`](../docs/BENCH-DESIGN.md), including the primary
measure and the three conditions that would kill the claim, before any cell ran.

`T8b` is `T8` with the literal payload rewritten in the attribute dialect. Crossed with the two
specs it gives *what the prompt specifies* × *what the data contains*. Slice 0.3 had only the
top row of that table.

## The prediction failed, and the failure is the result

Pre-registered prediction 1: adoption of the non-specified dialect is elevated on the
anti-diagonal **in both rows**.

| spec | payload | informative backends adopting |
|---|---|---|
| `S4b` (attribute) | `T8` positional — contradicts | **1/3** (ds-gateway) |
| `S4` (positional) | `T8b` attribute — contradicts | **0/3** |
| both | payload agrees with spec | 0/4 — prediction 2 holds |
| both | no payload at all | 0/8 under `S4b`, 0/6 under `S4` |

*"Informative" excludes MiniMax under `S4`, whose no-payload base rate is already 2/2: a model
that uses the other dialect anyway cannot show adoption of it.*

**An attribute payload pulled nobody.** The effect appears only in the direction Slice 0.3
happened to test. Stated as "a prompt-embedded envelope leaks syntax from data into control",
the mechanism is **not supported**. It has to be narrowed, and the README claim is narrowed
with it.

## What did replicate — exactly

`ds-gateway/S4b/T8`, second independent run, same shape:

```
turn 1  specified      write the payload
turn 2  specified      read it back
turn 3  variant        ← emitted in the dialect it had just handled as data
```

Slice 0.3's trace was `specified > specified > variant`. So was this one. This is the same
model, same cell, twice, in runs a day apart — and `ds-gateway` has **no measurable dialect
prior** (see below), conforms to whichever spec it is given, and shows 0/2 on the same form's
no-payload cells. For that one backend, on that one payload, the payload is doing the work.

## Two different phenomena were being counted as one

The clean result of this slice comes from the `S0` baseline, which asks the model to reproduce
five lines of literal text **with no tool protocol at all** — no envelope, no tools, just copy.

| backend | `T8` payload (positional) | `T8b` payload (attribute) |
|---|---|---|
| ds-direct | copied faithfully | copied faithfully |
| ds-gateway | copied faithfully | copied faithfully |
| kimi | copied faithfully | copied faithfully |
| minimax | **rewrote** `<parameter=path>` → `<parameter name="path">` | copied faithfully |

MiniMax cannot copy the positional dialect verbatim. Not "prefers not to" — asked for literal
text with nothing else in play, it normalised the line to its own dialect and failed the
baseline.

> **The dialect prior is a text-level phenomenon, not a tool-protocol one.** It survives the
> removal of the entire tool protocol. Which means it was never evidence about envelopes.

And that splits Slice 0.3's "2/2 dialect violations on the payload task" into two unlike
things:

- **MiniMax** used the other dialect because it uses the other dialect — on the payload task
  and on every other task, and even when merely copying text.
- **ds-gateway** used the other dialect only on the payload task, only in the direction of the
  payload, and only after handling it.

Slice 0.3 counted both as instances of one mechanism because they raise the same flag. They are
not the same mechanism. **Same observation, two constructs** — and pooling them made the
evidence look twice as strong as it was.

## Where this leaves the in-band claim

Narrowed, not retracted:

- A prompt-embedded envelope **can** have its control syntax displaced by syntax appearing in
  its data. One backend with no prior did it, twice, in the one cell where it was possible.
- It is **asymmetric**. Every adoption observed across both slices is toward the *positional*
  dialect. Nothing was ever pulled toward attribute. A payload appears able to activate a
  dialect a model already has some affinity for, and unable to install one it does not.
- The effect is **not** a property of prompt-embedded forms in general at the strength Slice 0.3
  implied. n is 1 backend, 1 direction, 2 runs.

The asymmetry has an obvious candidate explanation — positional is the dialect shipped by
widely-deployed open harnesses, so more models have seen it — and this bench cannot test that,
because testing it needs models whose training mix is known. **Labelled as speculation, not
carried forward as a finding.**

## Secondary: drift, and its base rate

| condition | drifted |
|---|---|
| payload dialect contradicts spec | 2/5 |
| payload dialect agrees with spec | 0/4 |
| no payload | 1/10 |

The no-payload drift is `minimax/S4/T7` in Slice 0.3, repeated here: it starts conformant and
**relapses to its own prior mid-cell**. Base drift is not zero, and a probe reported without it
would have made 2/5 look like a clean signal.

Drift also cannot be the primary measure, for a reason found before the run and recorded in the
pre-registration: **the payload is in the task prompt**, so it is in context before the first
call, and a model can adopt it from turn 1 with no drift at all. `minimax/S4b/T8` does exactly
that in both slices.

## Outcome rates, for completeness

| backend | `S4` | `S4b` |
|---|---|---|
| ds-direct | 1.00 (4/4) | 1.00 (4/4) |
| ds-gateway | 1.00 (4/4) | 0.75 (3/4) |
| kimi | 1.00 (4/4) | 1.00 (4/4) |
| minimax | 0.00 (0/4) | 0.75 (3/4) |
| ALL | 0.75 | 0.88 |

Consistent with Slice 0.3 and not independent of it: same models, overlapping tasks. The
`ds-gateway` loss is the contamination cell itself, which passed `verify` and failed strict
scoring — a task that worked, in a syntax the scaffold did not specify.

## Limits

- **One backend, one direction, two runs.** The replication is what makes it worth keeping; the
  n is what keeps it out of the abstract.
- `minimax/T8` is excluded from competence-gated views: it fails that task's `S0` baseline. It
  passes `T8b`'s. The exclusion is therefore *caused by* the prior under study, which is worth
  saying plainly rather than leaving in a footnote.
- The two payloads are matched in length, structure and instruction, and both `S0` baselines
  pass for three of four backends — so the pre-registered kill condition "the payloads are not
  equally reproducible" did not fire, except in the one case that is itself the finding.
- All four backends remain 3 independent model lineages. Nothing here separates an envelope
  effect from a model effect, and this slice was not designed to.
