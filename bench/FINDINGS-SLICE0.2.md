# Slice 0.2 — results

Run `2026-08-25T14-05-02-161Z`. 4 backends × 3 exposure forms × 7 tasks, 3 positive controls
per (backend, form), an `S0` no-tools baseline per (backend, task). 148 cells. Traces under
`runs/`.

Slice 0 and Slice 0.1 both saturated under tolerant scoring. Slice 0.2 changed the dependent
variable rather than the tasks: **conformance to the specified syntax is now part of the
outcome**, with tolerant reported alongside.

## Headline

| form | strict | tolerant | competence-gated (strict) |
|---|---|---|---|
| S1 native | **0.96** (26/27) | 0.96 | 1.00 (26/26) |
| S4 prompt-XML | **0.74** (20/27) | 0.93 | 0.77 (20/26) |
| S5 prompt-JSON | **1.00** (28/28) | 1.00 | 1.00 (27/27) |

Per backend, strict:

| backend | S1 | S4 | S5 |
|---|---|---|---|
| ds-direct | 1.00 | 1.00 | 1.00 |
| ds-gateway | 1.00 | 1.00 | 1.00 |
| kimi | 1.00 | 1.00 | 1.00 |
| minimax | 0.86 | **0.00** | 1.00 |

**The entire S4 deficit is one model.** Three of four backends score 7/7 on prompt-embedded
XML. MiniMax scores 0/7 — and 0/7 on that form only, while scoring 1.00 on prompt-embedded
JSON and 0.86 on native.

Decomposing MiniMax's seven S4 cells:

| | cells | what happened |
|---|---|---|
| dialect only | 5 (T1, T4, T6, T9, T3) | **task completed correctly** (`verify: ok`); strict F2 purely because the syntax was not the one specified. Tolerant reports OK. |
| dialect + parameter syntax collapse | 2 (T7, T8) | syntax degraded far enough that no parameters parsed; the artifact was never written. Fails tolerantly too. |

So: MiniMax used a non-specified XML dialect in **7/7** of its S4 cells. In five of those it was
cosmetic. In two it decayed into unreadable parameters and the task failed outright.

**A lenient consumer would report S4 at 0.93 and see none of this.** The 0.19 gap between
tolerant and strict is entirely conformance, and it is entirely one model.

## The in-band probe mostly did not bite — and that is the interesting part

Slice 0.1 named this as the sharpest remaining axis: a prompt-embedded envelope shares one
channel with its data, so a payload containing the envelope's own delimiters should be
structurally hostile to it, while a native schema carries the same bytes in an out-of-band
JSON field and is immune.

`T8` writes a file whose content is a complete, literal `<tool_call>` block. `T9` is the JSON
mirror. Result on `T8`, with an XML entity-escaping convention stated in the prompt:

| backend | escaping used | outcome |
|---|---|---|
| ds-direct | ✅ | OK |
| ds-gateway | ✅ | OK |
| kimi | ✅ | OK |
| minimax | ❌ | failed (parameter syntax collapse) |

And `T9` needed no convention from anyone: **JSON's escaping is part of the format**, so the
prompt-JSON envelope carried its own hostile payload with nothing added — 4/4, zero escaping
flags raised.

> **The in-band disadvantage is convention-dependent, not structurally inevitable.** Given a
> stated escaping rule, three of four backends followed it and the payload survived. The one
> that failed is the same model that fails everything else on that form. This is a negative
> result against the prediction that motivated the probe, and it moves the XML form's problem
> firmly from "cannot represent this" to "does not conform reliably".

## Cost becomes failure only when there is a budget — demonstrated, not asserted

Slice 0.1 showed the native form using parallel calls on the chain task and the
prompt-embedded forms taking more turns. Slice 0.2 asked whether that overhead ever becomes
an outcome. At `MAX_TURNS=6`, two S4 chain cells failed. Re-running only those cells at
`MAX_TURNS=10`:

| cell | at 6 turns | at 10 turns |
|---|---|---|
| `ds-direct/S4/T7` | F4 (`total.txt` never written) | **OK** |
| `minimax/S4/T7` | F2 | F2 strict, **OK tolerant** (`verify: ok` at 8 calls / 10 turns) |

So the ds-direct failure was a **budget** effect and the MiniMax failure was a **conformance**
effect, and the two were separated by moving a parameter rather than by argument. For
reference, the same task in the native form took 3 calls in 4 turns for every backend.

⚠️ `MAX_TURNS` is a harness parameter, and the finding is about **margin**, not capability:
per-turn overhead converts into failure at a budget where the native form still has slack. A
different cap moves the boundary.

## Retraction: a Slice 0.1 headline was a parser artifact

Slice 0.1 published:

> "parallelism appeared only in the native form … S4 0/28"

**That is false.** MiniMax emitted two `<function>` blocks inside a single `<tool_call>`, and
the parser read the first and silently discarded the rest. Re-scanning every persisted trace
across all runs: **5 of 181 `<tool_call>` blocks contained more than one function**, all
MiniMax, all S4 — including one in the Slice 0.1 run itself, which was therefore already on
disk contradicting the claim when it was published.

Corrected: S4 `parallelCalls` is **2/28** in this run, not 0. A prompt-embedded form does not
forbid parallel calls; models emit them even where the prompt says one at a time.

**A silent drop does not merely lose data. It manufactures the opposite finding**, and it does
so in the direction the analyst already expects, which is why it survives review.

## Second correction: a syntax failure was reported as a reasoning failure

The pre-fix analysis of the chain task described models "omitting arguments" — `list_dir {}`.
Reading the raw traces, the models omitted nothing. They emitted a fourth malformed dialect:

```
<parameter name="path>.</parameter>       quote opened, never closed   (MiniMax)
<parameter>content>42</parameter>          no name marker at all        (ds-direct)
```

Zero parameters parse from either. The earlier reading attributed to the *model's reasoning*
what belonged to the *envelope's syntax* — a claim pointing in exactly the wrong direction for
a project about tool-exposure form. The parser now counts `<parameter` tags present against
parameters successfully read and raises `paramSyntaxFailure` when they disagree: 4/28 on S4,
0/28 on S1 and S5.

Both corrections come from the same discipline that produced them: the raw traces were on
disk, and reading them was enough.

## What each envelope demanded (corrected parser)

| form | variant dialect | coercions | parallel calls | escaping | param syntax fail | malformed |
|---|---|---|---|---|---|---|
| S1 | 0/28 | 0/28 | 4/28 | 0/28 | 0/28 | 0/28 |
| S4 | **7/28** | **4/28** | 2/28 | **5/28** | **4/28** | 0/28 |
| S5 | 0/28 | 0/28 | 0/28 | 0/28 | 0/28 | 2/28 |

The native form asked for nothing. The prompt-JSON form asked for nothing except two recovered
malformations. The prompt-XML form is the only one that required an added escaping convention,
the only one that required structure to be string-encoded, and the only one where syntax
degraded to the point of parameter loss.

## The transport control did not replicate

| form | ds-direct | ds-gateway |
|---|---|---|
| S1 / S4 / S5 | 10/10, 0 malformed | 10/10, 0 malformed |

Slice 0.1 saw the gateway path fail the easiest `S4` control in both of its runs. On this run
the gap is gone. Part of that is the parser fix — the previous "malformed" count was partly
produced by the parser that has since been corrected — but the honest summary is that a
two-run observation did not survive a third run. **It is downgraded to an unreplicated
observation**, and the checkpoint confound it could never escape is unchanged.

An endpoint identity probe (`probe-identity.js`, 8 deterministic prompts at temperature 0)
found the two endpoints **byte-identical on 6/7 scored prompts** and divergent on the one
free-form prompt. That strengthens rather than dissolves the confound: they do differ
somewhere. High agreement on constrained prompts is not evidence of a shared checkpoint.

## Limits

- **The aggregate sits at the saturation guard** (0.90 overall). Discrimination is real but
  concentrated in a single (model, form) cell; four backends and seven tasks is not a sample
  from which to quote rates.
- **`kimi` lost 2 cells to gateway `429`/`524`.** Rate-limit responses were not retriable in
  this run — that is fixed for the next one, with longer backoff, because turning our own
  request pacing into an `ERROR` cell removes a measurement silently.
- **`minimax/T8` is excluded from the competence-gated view**: it could not reproduce the
  payload with no tool protocol at all, so its `T8` failures cannot be attributed to any
  envelope.
- Two runs of this slice exist; the first was discarded because the parser fix changes the
  trajectory, not just the score, and re-scoring from disk is not available when the harness
  changes what the model sees.
