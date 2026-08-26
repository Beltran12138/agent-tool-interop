> ### ⚠️ Narrowed by Slice 0.4 — read this first
>
> The section below titled *"The new result: in-band data leaks syntax into the control
> channel"* states the mechanism too generally. The mirror test — the same payload written in
> the **other** dialect — pulled nobody, so the effect is asymmetric and is not a property of
> prompt-embedded forms in general.
>
> Worse, the "2/2 on the payload task" figure below pools **two different causes**. One of the
> two backends rewrites that dialect even when asked to copy five lines of literal text with no
> tool protocol at all: its behaviour is a text-level prior, not contamination. Only the other
> backend's cell is evidence for the mechanism — and that one did replicate exactly, in a run a
> day later.
>
> Same flag, two constructs. Pooled, they made the evidence look twice as strong as it was.
> See [`FINDINGS-SLICE0.4.md`](FINDINGS-SLICE0.4.md). Nothing below is edited.

# Slice 0.3 — dialect swap

Run `2026-08-25T16-04-30-864Z`. 4 backends × 3 exposure forms (`S1`, `S4`, `S4b`) × 5 tasks,
3 positive controls per (backend, form), an `S0` no-tools baseline per (backend, task),
`MAX_TURNS=10`. Traces under `runs/`.

Pre-registered in [`../docs/BENCH-DESIGN.md`](../docs/BENCH-DESIGN.md) before the parser change
it required and before any cell ran. `S4b` is `S4` with one difference: the prompt specifies
the attribute dialect `<function name="X"><parameter name="Y">` instead of the positional
`<function=X><parameter=Y>`. Each backend is therefore its own control.

## What was being tested

Slice 0.2 measured prompt-XML at 0.74 strict against 0.96 / 1.00 for the other forms, with the
entire deficit coming from one model. Two readings survived that:

- **H1, form effect** — prompt-embedded XML is intrinsically harder to conform to.
- **H2, dialect prior** — prompt-embedded XML has no canonical dialect, so whichever one a
  scaffold specifies will mismatch some models' post-training priors.

## Headline: the prior is real, and swapping the spec moves the failures rather than removing them

Strict, all cells:

| backend | S1 | S4 (positional spec) | S4b (attribute spec) |
|---|---|---|---|
| ds-direct | 1.00 (5/5) | 1.00 (5/5) | 0.80 (4/5) |
| ds-gateway | 1.00 (5/5) | 1.00 (5/5) | 0.80 (4/5) |
| kimi | 1.00 (5/5) | 1.00 (4/4) | 1.00 (3/3) |
| minimax | 0.80 (4/5) | **0.00 (0/5)** | **0.60 (3/5)** |
| ALL | 0.95 | 0.74 | 0.78 |

Paired properly — only (backend, task) cells with a valid result in **both** forms, and only
those whose no-tools baseline passed — 17 pairs remain:

| | S4 | S4b |
|---|---|---|
| paired strict OK | 13/17 (0.76) | 14/17 (0.82) |

The discordant pairs are the whole of the effect: **2 pairs that `S4` won** (`ds-direct/T6`,
`ds-gateway/T8`) against **3 that `S4b` won** (`minimax/T1`, `T4`, `T6`). Two against three is
not a result. **The aggregate did not move.**

What did move is where the failures sit. Dialect violations, by form and task:

| form | cells with a non-specified dialect | which |
|---|---|---|
| `S4` (positional spec) | 5/20 | minimax on **every** task: T1 T4 T6 T7 T8 |
| `S4b` (attribute spec) | 2/20 | ds-gateway/**T8**, minimax/**T8** |

So:

> **H2 is supported and H1 is not tested.** MiniMax violated the positional spec on 5 of 5
> tasks and conformed to the attribute spec on 4 of 5. Its prompt-XML strict rate went from
> 0.00 to 0.60 with nothing changed but which dialect the prompt asked for. Slice 0.2's number
> was right; the reading "prompt-embedded XML is harder to conform to" is not what it showed.
> It showed **a spec that mismatched one model's prior**.

> **And the mismatch cannot be designed away.** Matching MiniMax cost both DeepSeek paths a
> cell each. There is no dialect a prompt-embedded XML scaffold can specify that every model
> conforms to — which is what "no canonical dialect" means. That is a property of the
> **ecosystem**, not of the envelope.

H1 remains undecided and this slice cannot decide it: three independent model lineages are
reachable with available credentials, and separating "this envelope is hard" from "this model
is unusual" needs a fourth. That limit was stated in the pre-registration, not discovered here.

## The new result: in-band data leaks syntax into the control channel

`T8` writes a file whose content is a literal `<tool_call>` block. That payload is a constant
in `tasks.js`, hard-coded in the **positional** dialect. So under `S4` the data agrees with the
spec, and under `S4b` the data contradicts it.

Under the matched spec, **both** dialect violations landed on `T8` and nowhere else — 2/2 on
that task, 0/12 on the other four. And under `S4`, where the payload agrees with the spec, the
two backends without a prior show zero violations, `T8` included.

`ds-gateway/S4b/T8` is the clean case. Turns 1 and 2 conform. The model writes the positional
payload to disk, reads it back, and **turn 3 is emitted in the positional dialect** — the one
it had just been handed as data. `verify` is `ok: true`: the task succeeded, the parse
succeeded, nothing was malformed. The only thing that changed is which syntax the model chose
next.

MiniMax shows the mirror image. It prefers the attribute dialect strongly enough to override
the `S4` spec on all five tasks — and on `T8` under `S4b` it abandons its own prior and emits
positional, the dialect in the payload.

> **This is a different in-band hazard from the one Slice 0.2 tested.** That slice asked
> whether the envelope can *carry* a hostile payload, and the answer was yes given a stated
> escaping convention. This one asks whether carrying it changes what the model *emits next* —
> and the answer looks like yes. It is not a parsing failure. It is contamination from the data
> channel into the control channel, which is available to a prompt-embedded form and
> structurally impossible for a native one, where the tool call never shares a channel with
> the file content.

⚠️ n = 2 violations on 1 of 5 tasks. This is a mechanism with a concrete trace behind it, not
a rate. The falsification is cheap and should be the next thing run: a `T8` variant whose
payload is written in the **specified** dialect should produce no drift, and injecting the
attribute dialect into the payload under the `S4` spec should produce drift toward attribute.

## Fixing conformance does not fix competence

`minimax/T7` went `F2` → `F4` across the swap: with a matched dialect the calls parse, and the
model then executes the chain and still writes the wrong total. Conformance and capability are
separate axes, and a scaffold that only counted parse success would have recorded this cell as
an improvement to "working".

## A one-cell hypothesis, labelled as such

`ds-direct/S4b/T6` is the other pair `S4` won. The model escaped `"` as `&quot;` — which is not
in the stated convention (`&`, `<`, `>` only), so the decoder left it literal and the content
mismatched. Its `S4` cell on the same task passed.

A plausible mechanism: the attribute dialect puts `"` into the markup itself, making quotes
inside values look like metacharacters. Counted across the grid, `&quot;` appears in **1/20**
`S4b` cells and **0/20** `S4` cells.

**One cell is not evidence for that mechanism.** It is recorded because it is the kind of
observation that turns into a finding if the next slice reproduces it, and into nothing if it
does not.

## Availability is a result

- **37 transport retries across 19 cells**, and **4 `ERROR` cells, all `kimi`** (`524` gateway
  timeouts and one network fault). `kimi` therefore contributes 4 valid pairs where the other
  backends contribute 5, and its `S4`/`S4b` comparison rests on 3 tasks. `ERROR` is never
  counted as a model failure.
- `minimax/T8` fails its no-tools baseline and is excluded from every competence-gated view: a
  backend that cannot reproduce the payload bare cannot tell us anything about the envelope
  carrying it.

## Limits

- **17 pairs, 2-vs-3 discordant.** No claim of significance is made or available. The strength
  here is mechanistic — which flag fired in which cell, with the trace on disk — not statistical.
- **`MAX_TURNS=10` here against 6 in Slice 0.2.** Slice 0.2 showed a chain-task failure that was
  purely a turn-budget effect, so the cap was raised. `T7` is therefore not comparable across
  the two slices.
- **The dialect swap changes only the tags.** Everything the two forms share — one call at a
  time, JSON-encoded non-strings, the `& < >` escaping rule — is untested as a design choice,
  and the `T6` observation above is a hint that the escaping rule interacts with the dialect.
- **Company-gateway models were considered as a fourth lineage and rejected**, because their
  traces cannot be published to this repository. A finding here is only worth what its trace is
  worth; data that cannot ship with its evidence is not neutral, it is a liability.
