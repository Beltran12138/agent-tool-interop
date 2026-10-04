# Slice 0.5 — multiplexed vs split tools

Run `2026-10-04T06-24-49-938Z`. Native `S1` envelope throughout. Two tool decompositions
(`MUX`: one `file_editor` with conditionally-required arguments; `SPLIT`: one tool per
operation), 6 tasks (`L1`–`L6`), 3 repetitions per cell, `MAX_TURNS=10`, plus `S0` no-tools
baselines for `L1`/`L2`. Runner `run05.js`, analysis `analyze05.js` (recomputes everything from
disk), offline assertions `test-slice05.js` (23).

Pre-registered in [`../docs/BENCH-DESIGN.md`](../docs/BENCH-DESIGN.md) in commit `a18b4fd`,
before any harness code for this slice existed. The motivating observation is
[`../docs/OPEN-CODING-02-right-fit.md`](../docs/OPEN-CODING-02-right-fit.md) §3.4: Kimi K3 under
OpenHands omitted `file_text` on 40% of its `create` calls.

## Result: no omission anywhere, which is what was predicted for these backends

| backend | arm | omitted / content-bearing calls | cells with an omission | outcomes |
|---|---|---|---|---|
| `ds-direct` | MUX | 0/21 | 0/18 | 18 OK |
| | SPLIT | 0/21 | 0/18 | 18 OK |
| `ds-gateway` | MUX | 0/21 | 0/18 | 18 OK |
| | SPLIT | 0/21 | 0/18 | 18 OK |
| `glm-flash` | MUX | 0/21 | 0/18 | 18 OK |
| | SPLIT | 0/24 | 0/18 | 18 OK |
| `minimax` | MUX | 0/24 | 0/18 | 18 OK |
| | SPLIT | 0/21 | 0/18 | 18 OK |

- **Prediction 1 holds** for DeepSeek (both routes) and GLM-5.3-Flash: at most one omission per
  arm. The actual count is zero.
- **MiniMax** had no directional prediction. Zero in both arms.
- **K2 cannot fire,** because there is nothing to compare. **K3 does not fire:** every reachable
  backend passed both `S0` baselines, `L2`'s 26-line verbatim payload included.
- **Prediction 2 and K1 are not evaluable.** Kimi K3 was not reachable.
- No `command`-absent calls, no unreadable arguments, and no irrelevant arguments in either arm.
  None of the `view_range`-on-`create` shape seen in the Right Fit traces appeared.

### What this shows, and what it does not

As pre-registered, an all-null result from the predicted-null backends is **not evidence against
OPEN-CODING-02 §3.4.** It shows only that the multiplexed decomposition imposes **no general
penalty** on DeepSeek V4 Flash, GLM-5.3-Flash and MiniMax M2.7, on these six tasks.

There is a second limit, and it is the Slice 0 problem in a new place. **The primary measure sits
at its floor in every cell.** Nothing in this run shows that the live pipeline would have
registered an omission if one had occurred. That sensitivity is established only offline:
`test-slice05.js` feeds the observed Kimi call shape through `interpret` and `cellMeasures`, and
two mutation checks (counting `null` as present; counting `command`-absent as a content omission)
each make the suite fail. That is evidence the measure is computed correctly. It is not evidence
that these tasks can elicit the behaviour. Only a backend that omits can show that, and the one
known to do so is unreachable. The slice is therefore **parked, not finished**. The `MUX`/`SPLIT`
harness is ready for Kimi K3 the moment a credential exists, and these 144 cells become its
predicted-null comparison arm.

## The retired backend, and two analysis defects it exposed

The gateway retired Kimi K2.6 between the backend probe and the run. Its credential still
resolved, so the runner treated it as available, and **36 cells plus 2 baselines came back
`ERROR 400`.** Under rule 8 they are excluded and are not model evidence. They stay on disk, and
nothing was deleted.

On the first pass the analysis did two things wrong with them:

1. **It matched the predicted positive by the substring `kimi`.** A different checkpoint (K2.6)
   would have stood in for K3 in prediction 2 and K1. With any `kimi` row present, it also
   suppressed the pre-registered caveat that K3 is absent. This is a construct substitution
   (family 2), and it was about to be printed under the heading of the very prediction it would
   have voided. Fixed: only a K3 model id with scored cells counts (`isK3Model`, with a new
   assertion).
2. **It treated an `ERROR` baseline as a failed baseline,** so K3 "fired" on a backend whose
   every request was a 400. This is the rule-8 conflation inside the guard that exists to
   enforce rule 8. Fixed: only an `F3` baseline counts.

Both fixes change classification only. `analyze05.js` recomputes from disk, so nothing was
re-run. `backends.js` now marks `kimi` as retired, so future runs report it as unavailable
(rule 5) instead of filling cells with errors.

## Exploratory, not pre-registered: the stop signal is ambiguous, and once it runs away

A finished agent often says `DONE` **while still attaching a tool call**: the content reads
"…DONE" and `tool_calls` holds a `view`. That turn shape appears in 13 backend × arm × task
combinations, across all four backends and **both arms**:

| backend | MUX turns | SPLIT turns |
|---|---|---|
| `ds-direct` | 0 | 0 |
| `ds-gateway` | 0 | 18 |
| `glm-flash` | 30 | 9 |
| `minimax` | 12 | 6 |

The runner continues whenever `tool_calls` is non-empty, as most native-tool scaffolds do. Usually
the next turn ends cleanly. In one combination it did not: **`glm-flash` / MUX / `L3` hit the
turn cap in 3 of 3 repetitions** (and in the smoke test, 4 of 4 in all). Each time the edit lands
on call 3, and then the model fans out 189 parallel `view` calls of the same file over the
remaining turns, re-announcing `DONE` each time. The same task under SPLIT ended normally 3 of 3,
and the other 15 GLM MUX cells were normal. GLM MUX made 627 calls in total, against 57 under
SPLIT and 39–60 for every other backend × arm.

What this does **not** license: an arm effect. The ambiguous turn shape is not MUX-specific,
and the runaway is one task on one backend. What it does show is a measurement dependency.
**Call counts and turns-to-completion depend on the harness's stop rule** whenever a model emits
completion and a call in the same turn. A rule of "stop on no tool call", "stop on a completion
marker", or "stop on either" would score these 4 cells very differently. Right Fit's harnesses
differ on exactly this: openJiuwen requires `<promise>task_complete</promise>`, and PI stops when
a turn has no tool call. Any comparison of agent efficiency across harnesses inherits it. Rule 2
from Slice 0, applied one level up: a stop rule is a harness constant that interacts with the
model, so it is a confound unless it is reported.

## Next

- **Kimi K3 access** (Moonshot first-party, or OpenRouter pinned to Moonshot with the pin
  verified per generation, given OPEN-CODING-02 §3.3). Run `node run05.js --backends=<k3>
  --reps=3` and evaluate prediction 2 and K1 against the arm above. Until then, OPEN-CODING-02
  §3.4 stays observational.
- If the stop-rule dependency is pursued, it needs its own pre-registration: same cells, three
  stop rules, the post-completion fan-out as the dependent variable. It is not a slice yet.
