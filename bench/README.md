# toolschema-bench

Does the **form** in which tools are exposed change whether a backend can drive them?

Everything is held fixed — task, tools, temperature, turn cap — except the envelope the
tools arrive in. The measurement design, including what result would falsify the whole
exercise, is in [`../docs/BENCH-DESIGN.md`](../docs/BENCH-DESIGN.md) and was written before
any code here existed.

## Exposure forms

| id | form |
|---|---|
| `S0` | no tool protocol at all — direct answer. **Construct check, not a schema.** |
| `S1` | native OpenAI-style function tools (`tools` field, `tool_calls` response) |
| `S4` | prompt-embedded XML (`<tool_call><function=…><parameter=…>`) |
| `S5` | prompt-embedded JSON, no native `tools` field at all |

`S0` exists to separate *"cannot use this envelope"* from *"cannot do the task."* A model
that fails `S0` is not schema-sensitive, it is failing the task. **The result of interest is
the spread across forms within one model, never the absolute rate.**

## Outcomes

| code | meaning |
|---|---|
| `OK` | executed, correct side effect |
| `F0` | no tool call emitted — affirmatively absent |
| `F1` | tool call emitted, wrong tool |
| `F2` | envelope present, arguments violate the declared schema |
| `F3` | right tool, valid arguments, wrong values |
| `F4` | executed, side effect absent or wrong |
| `ERROR` | transport / truncation / parse failure — **not evidence about the model** |

`F0` and `F2` point in opposite directions: `F0` says the form was never recognised as tools,
`F2` says it was recognised and the model then failed the schema. Collapsing them into one
"failure" number destroys the finding, which is why `SPEC.md`'s original binary
`compatible` / `dialog-only` split is not used here.

**`ERROR` is never `F0`.** A truncated reply, an HTTP failure, or an unreadable body cannot
tell us whether a tool call was coming. Recording those as "emitted nothing" would
manufacture the single most quotable false result this bench could produce — *"model X cannot
drive form Y"* — out of a plumbing fault.

## Scoring

Deterministic filesystem inspection inside a per-cell sandbox. Nothing reads the model's prose
to decide success. That is a deliberate choice made up front, not a defence found later:
tool-calling benchmarks that score by judging text have a documented evaluator-agreement
problem, and this bench has no budget to audit its own judge on top of auditing schemas.

## Running

```bash
cp .env.example .env     # then fill in credentials
node test-parsers.js     # offline, deterministic, no network — run this first
node run.js
```

Filters, for iterating without paying for the whole grid:

```bash
node run.js --backends=ds-direct --forms=S1 --tasks=T1 --no-baseline --no-controls
```

Backends run in parallel; cells within a backend run serially, so no single upstream sees
concurrent load.

Every cell — including its full request/response trace — is written to `runs/<timestamp>/`.
A claim that cannot be re-read from disk is not a result.

## Controls

Two positive controls per (backend, form), identical task, differing only in tool density:

- `C-easy` — one tool, no distractor
- `C-dense` — five tools, one plausible distractor

Both exist because an easy control certifies a sensitivity that may not survive realistic
density. A cell that passes `C-easy` and fails `C-dense` is flagged in the report rather than
averaged away.

## Reading the output honestly

- `n = 3` tasks per cell. **This is a screen, not an estimate.** The rates are not
  measurements and must not be quoted as such.
- `ERROR` cells are excluded from rates and reported separately, with their clustering by form
  and by backend, because a drop concentrated in one form is a finding rather than noise.
- Backend availability is printed before any score and is part of the result: silently
  dropping a backend that refused a particular envelope would bias the table toward whichever
  form the vendors happen to serve.
