# Slice 0.1 — results

> ⛔ **CORRECTION, 2026-08-25 (see [`FINDINGS-SLICE0.2.md`](FINDINGS-SLICE0.2.md)).**
> The claim below that **"S1 is the only form where parallelism appeared … S4 0/28"** is
> **false**. The parser read only the first `<function>` block inside a `<tool_call>` and
> silently discarded the rest. Re-scanning every persisted trace: 5 of 181 blocks contained
> more than one function, all MiniMax, all S4 — **including one in this very run**, which was
> already on disk contradicting the claim when it was published. Corrected figure: 2/28.
> Related: what this document's `T7` analysis reads as models "omitting arguments" was a
> parameter-syntax failure, not an omission. Both errors are documented in Slice 0.2.
> The rest of this document stands as written and is not edited retroactively.


Run `2026-08-25T09-04-29-292Z`. 4 backends × 3 exposure forms × 5 tasks, plus 3 positive
controls per (backend, form) and an `S0` no-tools baseline per (backend, task). 116 cells,
**zero ERROR**. Traces under `runs/`.

Slice 0 saturated and produced no usable rates. Slice 0.1 raised difficulty along four axes
chosen because the *envelope* governs them: argument structure, escaping, chain depth, and
selection pressure from near-synonym tools.

## Headline: it saturated again — and that is now the result

```
overall OK: 0.98 (59/60)
```

| backend | S1 | S4 | S5 |
|---|---|---|---|
| ds-direct | 1.00 | 1.00 | 1.00 |
| ds-gateway | 1.00 | 1.00 | 1.00 |
| kimi | 1.00 | 1.00 | 1.00 |
| minimax | 1.00 | 0.80 | 1.00 |

Harder tasks did not move it. The `S0` construct check, which was broken in Slice 0, now
returns **20/20** — every backend solves every task with no tool protocol at all. So the
ceiling is real task competence, not a measurement artifact, and the conclusion is not
"make the tasks harder again":

> **The binary outcome is the wrong dependent variable.** For any task these models can do at
> all, all three envelopes get them there. `OK` stops discriminating long before the envelopes
> stop differing.

## What still varies: each envelope has its own signature demand

| form | variant dialect | coercions | parallel calls | malformed |
|---|---|---|---|---|
| S1 native | 0/20 | 0/20 | **4/20** | 0/20 |
| S4 prompt-XML | **5/20** | **4/20** | 0/20 | 0/20 |
| S5 prompt-JSON | 0/20 | 0/20 | 0/20 | **2/20** |

The pattern is orthogonal, and every cell of it was predicted by the mechanism rather than
found by fishing:

- **S1 is the only form where parallelism appeared** — and it appeared for *every* backend:
  all four emitted exactly 2 concurrent `read_file` calls on the chain task, and all four
  finished it in 4 turns. Prompt-embedded forms specify one call at a time and cannot express
  it.
- **S4 is the only form that required encoding.** On the structured-argument task all four
  backends had to JSON-encode the array, the integer and the nested object into text
  (`tags:string->array`, `retries:string->integer`, `owner:string->object`), because an XML
  parameter carries a string and nothing else. All four did it correctly. A text-only envelope
  *can* carry structure — at the cost of a second encoding layer that the native and JSON
  forms never pay.
- **S4 is also the only form with dialect drift**, and **S5 the only one with malformed
  emissions** (both recovered).

**These are the differences a binary OK rate erases. "It worked" is not "it cost the same".**

## The number worth quoting: a fifth of S4's successes are parser tolerance

| form | tolerant OK | strict OK | delta |
|---|---|---|---|
| S1 | 1.00 | 1.00 | 0.00 |
| S4 | 0.95 | **0.75** | **−0.20** |
| S5 | 1.00 | 1.00 | 0.00 |

"Strict" projects what a scaffold that accepts only its own literal syntax would have scored.
S4 loses 20 points; the other two lose nothing. Drivability of a prompt-embedded form is
partly a property of *the consumer's leniency*, not of the model — and any benchmark with a
tolerant parser silently reports the generous number.

**Dialect drift is a model property here, not a form property**: MiniMax used the
non-specified attribute dialect in **5/5** of its S4 cells; the other three backends used the
specified dialect in **15/15**. Slice 0 saw the same split (3/3 vs 0/9). Two independent runs,
same direction.

## What did not work

- **Near-synonym distractors: selected in 0/60 cells.** Nine plausible shadow tools
  (`save_file`, `put_file`, `add_line`, …) created no measurable selection pressure. The
  "selection" axis contributed nothing and should not be counted as difficulty.
- **Turn counts barely move** (S1 2.6 / S4 2.8 / S5 3.0 pooled). Directionally consistent with
  the friction table, far too small an n to lean on.

## Transport control — a gap, and a confound that forbids naming it

| form | ds-direct | ds-gateway |
|---|---|---|
| S1 | OK 8/8, 0 malformed | OK 8/8, 0 malformed |
| S4 | OK 8/8, 0 malformed | OK 7/8, **1 malformed** |
| S5 | OK 8/8, 0 malformed | OK 8/8, 0 malformed |

The gateway path's `C-easy` control on `S4` failed in **both** independent runs, emitting a
third, garbled syntax (`<function>write_file</function>`, `<parameter>path>report.txt</parameter>`)
and never recovering across six turns — on the easiest task in the set, with one tool and no
distractor.

⚠️ **This must not be called a gateway effect.** The direct endpoint serves an unpinned
`deepseek-v4-flash`; the gateway serves a dated snapshot `…-0731`. A checkpoint difference is
not excluded, so the gap is "serving path **or** version". Naming it would be exactly the
category error this project exists to name. Resolving it needs a provider that pins the same
snapshot on both paths.

## Harness defects found this slice

Each of these would have produced a confident, wrong number:

1. **Parallel tool calls → HTTP 400.** The native form lets a model emit several calls at
   once and the API requires a tool message per `tool_call_id`. The harness executed only the
   first and echoed the whole array. It failed on precisely the chain task where native
   parallelism shows up, so S1's chain cells would have been dropped as `ERROR` — an
   availability skew correlated with the independent variable, inside a bench built to detect
   availability skew.
2. **The classifier named the first anomaly, not the failure.** A cell that emitted one bad
   argument, was told, fixed it, and then wrote a wrong value scored `F2` (schema violation)
   instead of `F3` (wrong value). Any model that stumbles once and recovers was being
   mis-attributed. Fixed by testing terminal state first; recovery is now a flag, not a verdict.
3. **The classifier inverted the F0/F2 distinction it exists to enforce.** A cell whose every
   turn produced an unreadable `<tool_call>` block has `anyCall === false`, and the first
   version read that as `F0` — *emitted no tool call at all* — about a model that emitted one
   every single turn and merely garbled the syntax. Absence is only absence when nothing
   tool-shaped was there.
4. **Non-enforcing tests.** The parallel-call assertions were appended *after* the summary and
   `process.exit(1)`, so they neither counted nor could fail the run. Assertions that cannot
   fail are worse than no assertions: they buy confidence without supplying any.
5. **Gateway 5xx storms deleted a whole run** (52 ERROR cells in 113) before bounded retry was
   added. Retries are for transport faults only — never for a real reply — and are counted and
   reported, because an unreported retry is hidden state.

Two runs were discarded rather than reported: one contaminated by the upstream outage, one
produced by the pre-fix harness. Neither is in `runs/`.

## What Slice 0.2 must change

1. **Change the dependent variable.** Score under strict parsing by default and report tolerant
   alongside, so dialect adherence is part of the outcome instead of a footnote. `OK` under a
   lenient parser has now failed twice to discriminate.
2. **Probe the envelope where it structurally cannot cope**, rather than making tasks
   generically harder: content containing the envelope's own delimiter (`</parameter>`,
   `<tool_call>`), with an escaping convention specified so it is a fair test of adherence and
   not a strawman. This is the one axis Slice 0.1 deliberately stopped short of.
3. **Drop the selection axis** or replace it with something that actually bites.
4. **Pin the same checkpoint on both serving paths**, or stop claiming the transport control
   can separate anything.

## What Slice 0.1 established

- **All four backends drive all three exposure forms, on tasks up to a four-step chain with
  nested structured arguments and delimiter-adjacent content.** Binary drivability is not the
  binding constraint for these models.
- **The envelopes are equally drivable and unequally demanding**, and the demands are specific,
  measured and mechanism-predicted: parallelism only in the native form, string-encoding of
  structure only in the XML form, dialect drift only in the XML form.
- **A fifth of the XML form's successes depend on the consumer being lenient.**
