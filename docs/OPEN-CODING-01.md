# Open coding 01 — reading the failures before designing the next slice

**Status:** qualitative error analysis, not a bench slice. 22 failure traces coded, drawn from
material already on disk. No new model calls were made. Written before the next slice is
designed, so that the slice is designed from failures and not from a grid.

**Date:** 2026-09-25 · **Coder:** one (an LLM assistant, under the maintainer's direction) ·
**Inter-rater agreement:** none measured — see §7.

---

## 1. Why this exists

Slice 0 was designed grid-first: 3 forms × 3 tasks × 4 backends, fixed before a single failure
had been looked at. It saturated at the ceiling (spread 0.00 across the grid), and its
falsification conditions could not fire in either direction (`../bench/FINDINGS-SLICE0.md`,
[`MEASUREMENT-DISCIPLINE.md`](MEASUREMENT-DISCIPLINE.md) §1). Slices 0.1–0.4 then found real
signal, but each was designed from the previous slice's aggregate table, not from its traces.

Hamel Husain and Shreya Shankar's *AI Evals: Everything You Need to Know*
(<https://hamel.dev/blog/posts/evals-faq/>, published 2026-09-18, revised 2026-09-21) puts
error analysis first: read traces, write down what is wrong in free text ("open coding"), group
the notes into a failure taxonomy ("axial coding"), and only then decide what an evaluator
should measure. Their target is product evaluation rather than a backend bench. The order of
work still transfers, and this repository had not followed it.

The practical question is what the next slice should measure. This document answers it from
the failures that already exist.

## 2. Sources, inclusion and exclusion

**Construct.** A trace is in scope if the failure is in the **backend's emission of a call
against its declared form**. That covers no call (`F0`), the wrong tool (`F1`), a
schema-violating or malformed call (`F2`), and a wrong argument value where the error is a
*format or encoding convention* rather than task reasoning (`F3`-format). Agent-side
observations (`../analysis/01-function-vs-rpc-wrapping.md`) are excluded by the
no-mixing rule in [`BENCH-DESIGN.md`](BENCH-DESIGN.md) §1.1.

| source | candidates | included | excluded, and why |
|---|---|---|---|
| Bench runs kept in [`../bench/runs/`](../bench/runs/README.md): Slice 0, 0.1, turn-budget, 0.2, 0.3-smoke, 0.3, 0.4, plus the pre-fix 4-cell smoke | 57 non-`OK` cell-runs | 37 cell-runs = **17 distinct cells** | 14 `ERROR` (transport, truncation, `524`, timeouts — not evidence about the model, per rule 2); 6 `S0` baseline `F3`s (no tool protocol present) |
| Superseded Slice 0.2 first attempt (`2026-08-25T12-42-28-766Z`) | 17 non-`OK` | 0 | Its parser was later changed in a way that alters trajectories, so it cannot be rescored. |
| Local session store of an open-source coding CLI (OpenCode), three non-Anthropic backends, sessions 2026-03 → 2026-09 | 68 tool parts with `status: error` out of 1,746 tool parts | **5 traces** (8 calls) | 60: network or HTTP failures (36), task reasoning such as a wrong path, `oldString` not found or identical strings (9), permission or abort (6), runtime errors or stale page state inside the tool (5), harness read-before-write policy (4) |
| Agent-side traces (a closed CLI driven by a third-party backend) | — | 0 | Agent side; must not be mixed with backend-side results. |
| Claude Code session logs | not enumerated | 0 | **Coverage gap.** These are single-vendor sessions, and the form is fixed. |

**Unit.** One row per distinct (backend, form, task) cell for bench material, with every run in
which that cell failed listed as occurrences. For the CLI store, one row per model turn: four
parallel calls in one turn count as one trace.

**Independence.** Low. 14 of the 17 bench cells are one backend (`minimax`). The three
`ref=` traces come from one session. Read the counts below as counts of *coded cells*, not as
rates.

## 3. The traces

Turn numbers are the 0-indexed `turn` field in each cell file. The `FINDINGS-*` documents count
turns from 1.

| # | source | fact | open code (free text, written before grouping) |
|---|---|---|---|
| B01 | `minimax/S4/T7` — runs 0.1, turn-budget, 0.2, 0.3, 0.4 | Every run opens with `<parameter name="path>.` (quote never closed), so the parameter is dropped and validation fails. In 0.2 it then calls the distractors `scan_dir` and `load_file` and runs out of turns. In 0.1 it wrote `59`. | Emits the attribute dialect it prefers, not the specified one, then corrupts its own quoting. After repeated validation errors it starts trying near-synonym tools instead of fixing the syntax. Once it emits `</tool__call>`. Packs two `<function>` blocks into one call despite "one call at a time". The 0.1 `59` is a harness defect (second block dropped, later fixed), not the model. |
| B02 | `ds-gateway/S4/C-easy` — 0.1 | Six turns of `<function>write_file</function><parameter>path>…`, byte-identical except one. It apologizes on turn 5 and repeats itself. | A third dialect that appears in no spec. The error feedback produces no change at all. The same cell passes in every later run, so this is not a stable property. |
| B03 | `minimax/S4/C-easy` — 0.2, 0.3, 0.4 | 0.2: attribute dialect, correct otherwise. 0.3/0.4: `<parameter name=path">` (opening quote missing), then fixed on the next turn. | Its prior overrides the spec. Quote corruption is at the token level and is self-corrected in one turn once told. |
| B04 | `minimax/S4/C-dense` — 0.2, 0.3, 0.4 | Same as B03. The quote corruption appears in 0.4 only. | As B03. The distractor was never selected. |
| B05 | `minimax/S4/C-hard` — 0.2, 0.3, 0.4 | Attribute dialect. Typed values written as JSON text, as the spec requires. | **Nothing is wrong except the dialect.** The task succeeded. This is a failure only relative to the literal spec. |
| B06 | `minimax/S4/T1` — 0.2, 0.3-smoke, 0.3, 0.4 | Attribute dialect. 0.4 adds the `name=path"` corruption and fixes it on the next turn. | As B03. |
| B07 | `minimax/S4/T3` — 0.2 | Attribute dialect, correct append. | Spec-only, as B05. |
| B08 | `minimax/S4/T4` — 0.2, 0.3 | Attribute dialect, correct record. | Spec-only. |
| B09 | `minimax/S4/T6` — 0.2, 0.3 | Attribute dialect. `<tag attr="x">` written raw inside a value that the spec says must be escaped, and the parser accepted it. | Spec-only for the dialect, but there is also an **escaping violation that the parser masked**. A lenient parser turned a nonconformant call into a clean one. |
| B10 | `minimax/S4/T9` — 0.2 | Attribute dialect, correct nested JSON payload. | Spec-only. |
| B11 | `minimax/S1/T8` (**native form**) — 0.2, 0.3 | The API's native `tool_calls[].function.arguments` arrives already cut off: `content` ends at `<parameter=path>trap.txt`, and a `path` key appears *after* `content`. The model's visible reasoning quotes the full five lines. It then rewrites, reads back, calls `create_file` (once with a corrupted `"\"path"` key) and `put_file`, and explains that "the system is interpreting my write_file calls". | The cut happens **before the harness sees anything**. The key order is what you would get from a serving-side parser that turns an in-band XML tool format into JSON and ends the value at the first inner delimiter. For this backend the "native" form is prompt-embedded XML one layer down, and it inherits the in-band hazard that native forms were assumed to be immune to. The model diagnoses the problem correctly and then responds by switching tools. (Mechanism is inferred; the raw token stream is not visible.) |
| B12 | `ds-direct/S4b/T6` — 0.3 | Writes `&quot;` for `"`. The spec's escape set is `& < >` only, so the entity is never decoded and the file does not match. | Over-escaping: it applied HTML habits beyond the declared set. Already noted in `FINDINGS-SLICE0.3.md`. |
| B13 | `ds-gateway/S4b/T8` — 0.3, 0.4 (same shape both runs) | Turns 0–1 are conformant calls. **Turn 2 is not a call**: it is the completion message — "The file contains exactly the five lines…" — followed by the read-back file content inside a fenced code block, then `DONE`. The parser extracted the fenced text as a `write_file` call with no `content`. On turn 3 the model says the task is already complete. | **The model is quoting a tool result, and the harness read the quotation as an invocation.** This is not the model choosing a new syntax for its next call. See §5.1. |
| B14 | `minimax/S4b/T7` — 0.3 | Turn 1 begins with `<tool__call>` (double underscore) and holds two `read_file` blocks. It was parsed as `none` (no tool structure), so the loop ended and the cell was scored `F4`. | The model corrupted the opening tag. **The harness classified text that is visibly tool-shaped as "no call"**, which is the conflation rule 2 forbids. The outcome code describes an execution failure that never happened. |
| B15 | `minimax/S4/T8` — 0.2, 0.3, 0.4 | Puts the payload envelope **raw** inside `content`, against the stated escaping rule. The parser reads the inner call, so `content` is missing. The identical call is retried 2–3 times, then `save_file`, `put_file` and `create_file` are tried. In 0.4 it escapes correctly on turn 2, but writes the payload as `<parameter name="path">` where the task says `<parameter=path>`. | Ignores the escaping rule and does not adapt to the error. Hops between distractors. When it does recover, it **normalizes the data it is copying into its own dialect**: the same prior as its `S0` baseline, which fails the copy with no tool protocol present at all. |
| B16 | `minimax/S4b/T8` — 0.3, 0.4 | As B15 under the attribute spec. 0.3 ends with a turn opening `<tool__call>`, which is parsed as `none` and ends the loop. 0.4 recovers by escaping, but rewrites the payload dialect. | As B15, with the B14 harness misreading on the final turn. |
| B17 | `minimax/S4/T8b` — 0.4 | Raw nesting on every turn. It cycles through `create_file`, `put_file`, `save_file` and `load_file`, with a `read_file` between each, until the turn cap. | Pure retry-and-hop. Ten turns and no adaptation of the escaping. |
| O1 | OpenCode store, part `prt_cf569ac4c…` — backend `big-pickle`, native form, 2026-03-16 | `todowrite` called with `todos` as a JSON **string** of an array. The harness returns a zod `invalid_type` error with "Please rewrite the input". | A native-form type error: the value was serialized one level too many. The model never calls `todowrite` again and moves on to `bash`. **It routes around the tool rather than repairing the call.** |
| O2 | part `prt_f97926767…` — `deepseek-v4-pro`, native, browser-automation MCP, 2026-07-25 | `click` with `target: "ref=f29e182"`. The tool expects the bare ref, and the error is `Unknown engine "ref"`. | A string-format convention error. The schema accepts any string, so the call validates and fails in the tool. The next call switches to a free-form `run_code` tool. |
| O3 | part `prt_f97956162…` — same session | Same `ref=` prefix on a different element, a few turns later. | **The convention is not learned from O2**: the same error again, routed around the same way. |
| O4 | part `prt_f97978ef4…` — same session | `snapshot` called with `target: "ref=f37e454"`. | Third repetition, now on a different tool that shares the convention. |
| O5 | parts `prt_dd34e5a08…` ×4 (one turn) — `big-pickle`, native, 2026-04-28 | Four parallel `glob` calls with POSIX-style drive paths (`/c/…`) on a Windows host. The tool rejects them. | A path-dialect convention from a different shell. **Borderline**: this may be environment knowledge rather than call emission. The model recovers by switching to `bash` with native paths. |

## 4. Taxonomy (axial coding)

The categories came from grouping the open codes above, not from the outcome codes. A trace can
carry several codes. Counts are rows (of 22) carrying the code.

| family | code | rows | n |
|---|---|---|---|
| **A. Envelope production** | A1 own dialect prior overrides the spec | B01, B03–B10, B15, B17 | 11 |
| | A2 token-level corruption of the envelope (unbalanced quote, `tool__call`) | B01, B03, B04, B06, B14, B15, B16 | 7 |
| | A3 unrecognized dialect, invariant under feedback | B02 | 1 |
| | A4 several calls in one envelope despite the one-call rule | B01, B14 | 2 |
| **B. Value representation** | B1 in-band payload left unescaped against a stated rule | B09, B15, B16, B17 | 4 |
| | B2 escaping outside the declared set | B12 | 1 |
| | B3 data normalized to the model's own dialect while being copied | B15, B16 | 2 |
| | B4 native type serialized one level too many | O1 | 1 |
| | B5 argument string in the wrong convention (the schema can't express it) | O2–O4, O5 (borderline) | 4 |
| **C. Serving layer** | C1 native arguments truncated at an in-band delimiter before reaching the client | B11 | 1 |
| **D. Recovery** (what happens *after* the first error) | D1 fixes the call on the next turn | B01, B03, B04, B06, B15, B16 | 6 |
| | D2 repeats the identical failing call | B02, B11, B15, B16, B17 | 5 |
| | D3 hops to near-synonym distractors | B01, B11, B15, B16, B17 | 5 |
| | D4 abandons the tool for a general-purpose one | O1, O2, O3, O4, O5 | 5 |
| **E. Instrument** (harness, not backend) | E1 quotation of a tool result parsed as an invocation | B13 | 1 (2 runs) |
| | E2 tool-shaped malformed text classified as "no call", ending the loop | B14, B16 | 2 |
| | E3 second `<function>` block dropped (fixed after 0.1) | B01 (0.1 run only) | 1 |
| | E4 lenient parser silently accepts a rule violation | B09 | 1 |

Five rows (B05, B07, B08, B09, B10) have **no consequence under a tolerant reading**: the task
succeeded and only the literal dialect differs. Excluding them leaves 17 rows. Excluding the
borderline O5 as well leaves 16.

## 5. What the reading changes

### 5.1 The replicated contamination trace is an instrument finding (E1)

`FINDINGS-SLICE0.3.md` presents `ds-gateway/S4b/T8` as "the clean case" of data-to-control
contamination: turn 3 is "emitted in the positional dialect — the one it had just been handed
as data". `FINDINGS-SLICE0.4.md` reports it replicating "turn for turn".

The raw reply on that turn is a completion message. The payload appears inside a fenced code
block as a quotation of what the file contains, and the message ends with `DONE`. The model did
not issue a call in the payload's dialect. The parser scanned the whole message and read the
quotation as a call. What replicated is that **this model restates the read-back content in its
closing message**. It does not show the payload changing what the model emits next.

This still matters, in a different way. Any scaffold that scans the whole assistant message for
envelopes will execute a model's quotation of its own tool results. That hazard is real, and it
is specific to prompt-embedded forms. But it belongs to the **parser**, which cannot tell
quotation from invocation, and not to the backend's syntax choice. The 0.3/0.4 claim needs to
be restated before it is cited again. This document does not edit those files. The restatement
is left to a dated amendment, per the no-silent-edit rule.

### 5.2 "Native forms are immune to in-band payloads" is false for at least one serving stack (C1)

Slice 0.2 argued that a native schema "carries the same bytes in an out-of-band JSON field and
is immune". It then excluded `minimax/T8` from the competence-gated view because the backend
cannot reproduce the payload even without a tool protocol.

B11 shows a different mechanism, and the exclusion hid it. The native arguments arrive truncated
at an inner delimiter, with keys in an order that only an in-band parser would produce. The
baseline failure (B3, dialect normalization) and the native failure (C1, truncation) are two
diseases, and one exclusion rule covered both. Wherever a backend's native tool calling is
implemented by server-side parsing of an in-band format, the native form is out-of-band only at
the API.

### 5.3 The grid's variance is mostly one model

14 of the 17 bench rows are `minimax`. Every A1 row is. A grid that adds tasks will mostly
re-measure this one backend's dialect prior. The other three backends' failures are single,
non-recurring cells (B02, B12) and one instrument artifact (B13).

### 5.4 Real-world emission failures are rare, and look different

In the CLI store, 5 of 1,746 tool parts are in-construct: about 0.3%, or about 0.2% without
the borderline case. None of them are envelope failures (A); all are value-representation
failures (B4, B5). Every one of them was handled by **routing around** the tool (D4), which a
pass/fail cell cannot see. Native forms in real use are close to the ceiling that Slice 0 hit.
That is consistent with Slice 0's saturation being a true reading for native forms, not an
instrument artifact.

## 6. Consequences for the next slice

1. **Fix the instrument before measuring anything new.**
   - E1: do not extract envelopes from text that follows a completion marker or sits inside a
     fenced block. Alternatively, record `quoted` as its own parse outcome.
   - E2: text containing `function`/`parameter` structure under a misspelled opener is
     `malformed`, never `none`.
   - Then recompute every persisted cell with `node analyze.js` and report every code that
     moves. E1/E2 change only the classification, so recomputation is valid for them. It is not
     valid for anything that would have changed what the model saw next.
2. **Restate the 0.3/0.4 contamination claim** in a dated amendment, per §5.1.
3. **Recovery is the dependent variable the grid is missing.** Record, per cell: turns to the
   first valid call, and recovery type (D1 adapt / D2 repeat / D3 hop / D4 abandon). D3 already
   has an instrument, because the distractors are there. D4 needs a general-purpose tool in the
   tool set to be observable at all.
4. **Add a serving-stack factor** for C1. Test the same payload through a native form on a
   backend whose native tool calling is known to be server-parsed, and on one where it is not.
5. **Choose backends by whether they fail, not by availability.** At least one more backend with
   a measurable dialect prior is needed before any A-family claim can be separated from
   "`minimax` behaves like this".
6. **Take the B5 convention errors seriously as a class.** They pass schema validation by
   construction. Only execution in the tool catches them, so a schema-only harness will never
   see them. They are also the only in-construct class found outside the bench.

## 7. Limits

- **One coder, and a primed one.** The coder had read every `FINDINGS-*` file before coding,
  and the open codes may inherit their framing. §5.1 is the one place where the traces
  contradicted that framing. That does not show the coder was unprimed elsewhere. A second coder
  working blind to the findings files is the missing control.
- **The sample is non-independent and single-backend-dominated** (§2, §5.3).
- **The C1 mechanism is inferred** from the argument text and key order. The raw token stream
  is not observable through the API.
- **The CLI store is one user's usage**: coding and browsing tasks on Windows. The ~0.3% base
  rate does not transfer to other workloads.

## 8. What would falsify this

- **§5.1 is wrong if** a parser that ignores fenced and post-`DONE` text still records
  `ds-gateway/S4b/T8` switching to the payload's dialect on an actual invocation.
- **§5.2 is wrong if** the truncation reproduces when the same arguments are replayed through
  a client-side-only path, which would put the cut in the client, not the server.
- **§5.3 is wrong if** a second backend with a dialect prior shows A1/A2 at a comparable cell
  count under the same prompts.
- **The taxonomy is incomplete if** coding 20 fresh failure traces (from a recovery-instrumented
  run) produces a new top-level family. Hamel & Shankar's stopping rule is saturation: new
  traces stop producing new categories. This set has not been tested against that.
