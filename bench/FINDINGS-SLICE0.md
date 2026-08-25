# Slice 0 — results

Run `2026-08-25T07-44-29-649Z`. 4 backends × 3 exposure forms × 3 tasks, plus 2 positive
controls per (backend, form) and an `S0` no-tools baseline per (backend, task). 72 cells.
Every cell, including its full request/response trace, is under `runs/`.

## Headline: the grid saturated. Slice 0 did not answer its question.

| backend | S1 | S4 | S5 | spread |
|---|---|---|---|---|
| ds-direct | 1.00 | 1.00 | 1.00 | 0.00 |
| ds-gateway | 1.00 | 1.00 | 1.00 | 0.00 |
| kimi | 1.00 | 1.00 | 1.00 | 0.00 |
| minimax | 1.00 | 1.00 | 1.00 | 0.00 |

34 of 36 grid cells `OK`; the other 2 were `ERROR`. No `F0`, `F1`, `F2`, `F3` or `F4` anywhere.

**This is a ceiling effect, not a null result, and the distinction is the whole point.**
Zero spread at a mean of 1.00 does not say the forms are equivalent — it says no difference
of any size could have appeared, because every cell was already at the rail. The tasks lack
discriminative power at this difficulty.

> ⚠️ **The harness got this wrong on the first run and printed
> `falsification condition 1 fires. Report the negative result`.** That would have published
> "tool-exposure form is a second-order effect" on the strength of an instrument that could
> not have detected a first-order effect either. A ceiling/floor guard has been added: at an
> overall rate ≥0.90 or ≤0.10 the run now reports *no discriminative power* and explicitly
> refuses to evaluate the falsification condition.
>
> This is the same failure the design's own rule 1 warns about — an instrument that is too
> easy certifies a sensitivity that does not exist — occurring at the level of the whole grid
> rather than of a single control. Both positive controls also passed everywhere, including
> the "realistic density" one, so the control layer did not catch it either.

## The one real signal: dialect deviation

| form | tolerant OK | strict OK | rescued by parser tolerance |
|---|---|---|---|
| S1 (native) | 12/12 | 12/12 | 0 |
| S4 (prompt XML) | 11/11 | **8/11** | **3** |
| S5 (prompt JSON) | 11/11 | 11/11 | 0 |

All three rescued cells are MiniMax on `S4`, and they are **all** of MiniMax's `S4` cells.
Read from the raw records:

- MiniMax emitted `<parameter name="path">` (attribute dialect) in 3/3 cells, and
  `<function name="read_file">` in one of them.
- The prompt specified `<parameter=path>` / `<function=NAME>`.
- ds-direct, ds-gateway and kimi each emitted the specified dialect in 3/3 cells.

So in this sample, deviation from the specified prompt-embedded syntax was **total for one
model and absent for the other three**. It is a model property here, not a property of the
form.

⚠️ n = 3 cells per model per form. This is a screen. "3/3 vs 0/3" is a direction, not a rate.

### How this signal was nearly lost, and nearly inverted

The first parser accepted only the specified dialect. Under it, MiniMax's structurally valid
calls parsed to `args: {}` and scored `F2` — *schema violation*. Three `F2`s in one form would
have read as "prompt-embedded XML is brittle," a finding about a regex wearing the clothes of a
finding about models.

The fix was not to loosen the parser. Loosening alone discards the adherence signal, which is
exactly the phenomenon the model-side literature reports. The parser now accepts both dialects
**and records which was used**, so drivability-under-tolerance and drivability-under-strictness
are reported as two numbers. Neither alone is honest: the first overstates what a real strict
scaffold would accept, the second lets parser choice masquerade as model behaviour.

A companion trap was fixed at the same time: `S5`'s presence marker was narrower than `S5`'s
parser. A variant-dialect JSON call would have failed the marker and been recorded `F0` —
*emitted nothing at all*. **A marker narrower than its parser manufactures false absence.**

## ERROR cells: 6, and they are ours, not the models'

```
base_ds-direct_T1      truncated
base_ds-direct_T3      truncated
grid_ds-direct_S5_T3   finish_reason=length
ctl_kimi_S4_C-easy     http_error 524
grid_kimi_S4_T3        finish_reason=length
base_minimax_T3        truncated
clustering by form:    S0:3  S4:2  S5:1  S1:0
```

Five of six are truncation at `max_tokens=1024`. The clustering is not noise and not a finding
either: **prompt-embedded forms spend output tokens on the tool-call envelope that native tools
spend in a structured field**, so the token ceiling bites `S4`/`S5` and never bites `S1`. A
harness parameter that interacts with the independent variable is a confound. `max_tokens` is
now 4096.

Recorded as `ERROR` throughout, never as `F0` — which is the only reason the confound was
visible rather than being absorbed into "these forms emit fewer tool calls."

One further latency note: a single Kimi reply took 63 s, and the original 120 s per-request
timeout produced timeouts that would have read as backend failures. Now 300 s.

## The construct check has its own construct problem

`S0` asks the model to state the required file content directly, with no tool protocol, to
separate *cannot use this envelope* from *cannot do the task*. Results: 1/3, 2/3, 2/3, 1/3.

Models scored **worse without tools than with them** — which is not credible as task
competence. Reading the failures: they are mostly truncation, plus MiniMax answering
`"The content of the file sho…"` instead of the bare content. `S0` is therefore measuring
*"will you reply with only the requested string"* — an instruction-following construct — and
not *"can you do the task."*

So the control that exists to check the grid's construct validity does not currently measure
what it claims to. It cannot be used to interpret the grid until it is fixed. Filed rather
than quietly dropped, because a broken control that still prints numbers is worse than no
control.

## What must change before Slice 0.1

1. **Difficulty, first and above all.** Tasks must produce variance or nothing downstream is
   measurable. Candidates: many more tools (20–40, so selection is a real problem), tool names
   that are near-synonyms, deeper required chains, arguments with structure (nested objects,
   arrays, enums) rather than three flat strings.
2. **Fix or retire `S0`.** Score task competence in a way that does not depend on output
   formatting.
3. **Re-run with `max_tokens=4096` and the 300 s timeout** so `ERROR` stops correlating with
   the independent variable.
4. **Only then** is the §4 falsification condition evaluable.

## What Slice 0 did establish

It was not a wasted run, but it is important to be exact about what it bought:

- The harness works end to end across four backends and three exposure forms.
- Three specific mechanisms that would each have produced a clean, quotable, false result were
  found and closed: dialect-strictness inflating `F2`, a marker narrower than its parser
  manufacturing `F0`, and a token ceiling correlated with the independent variable.
- The `OK`/`ERROR` separation earned its keep on the first real run — every one of the six
  `ERROR` cells would otherwise have been scored as model failure.
- **At these difficulties, all four backends drive all three exposure forms.** That is a real
  if narrow statement: for simple file-editing tasks with five flat-argument tools, the form
  does not appear to be the binding constraint for any of these models.
