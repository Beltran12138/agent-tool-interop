# Run index

| run | what it is |
|---|---|
| `2026-08-25T07-37-34-492Z` | single-cell smoke test while wiring the loop up |
| `2026-08-25T07-37-48-079Z` | 4-cell smoke test. **Pre-fix state**: shows the strict-dialect parser producing `args: {}` on a structurally valid call, and the 120 s timeout firing on Kimi. Evidence for two fixes in `../FINDINGS-SLICE0.md`. |
| `2026-08-25T07-44-29-649Z` | **Slice 0.** 72 cells. `../FINDINGS-SLICE0.md`. |
| `2026-08-25T09-04-29-292Z` | **Slice 0.1.** 116 cells. `../FINDINGS-SLICE0.1.md`. Contains `grid_minimax_S4_T7`, whose turn-2 reply holds two `<function>` blocks — the evidence that was already on disk contradicting that document's parallelism claim when it was published. |
| `2026-08-25T12-42-28-766Z` | Slice 0.2, **first attempt, superseded**. Kept because its traces are what revealed the two parser defects: the dropped second `<function>` block and the parameter-syntax failure misread as argument omission. Its numbers are not the reported ones. |
| `2026-08-25T13-59-18-477Z` | **Turn-budget experiment.** Only `T7`, `--max-turns=10`. Shows `ds-direct/S4/T7` going F4 → OK while `minimax/S4/T7` stays F2, separating a budget effect from a conformance effect by moving a parameter. |
| `2026-08-25T14-05-02-161Z` | **Slice 0.2.** 148 cells, post-fix. The reported run. `../FINDINGS-SLICE0.2.md`. |
| `2026-08-25T15-59-54-215Z` | 4-cell smoke test for the dialect-swap pipeline, run before the grid. Kept because it is where the `S4`→`S4b` signature first appears on MiniMax, and because a smoke test that is discarded once it agrees with the hypothesis is not a smoke test. |
| `2026-08-25T16-04-30-864Z` | **Slice 0.3.** Dialect swap, `S1`/`S4`/`S4b` × 5 tasks, `--max-turns=10`. `../FINDINGS-SLICE0.3.md`. Contains `grid_ds-gateway_S4b_T8`, the cleanest trace of data-to-control syntax contamination: two conformant turns, then a turn in the dialect the model had just been handed as file content. |
| `2026-08-26T03-34-05-263Z` | **Slice 0.4.** The contamination 2×2 — `S4`/`S4b` × `T8`/`T8b`. `../FINDINGS-SLICE0.4.md`. Two things live here that nothing else has: `grid_ds-gateway_S4b_T8` reproducing the Slice 0.3 drift sequence turn for turn a day later, and the `S0` baselines showing one model rewriting a payload's dialect while merely copying it — a prior that survives with no tool protocol present at all. |
| `2026-10-04T06-21-37-030Z` | 8-cell smoke test for Slice 0.5 (`run05.js`, `ds-direct` + `glm-flash`, `L1`/`L3`, 1 rep). All `OK`, zero omissions. Kept because `s05_glm-flash_MUX_L3_r1` is where the post-completion view loop first appears: the edit lands on call 3, then 189 parallel `view` calls follow until the turn cap. The same task under `SPLIT` used 5 calls. Not a pre-registered measure. |
| `2026-10-04T06-24-49-938Z` | **Slice 0.5.** `MUX` vs `SPLIT` × `L1`–`L6` × 3 reps, `--max-turns=10`. `../FINDINGS-SLICE0.5.md`. 144 scored cells, all `OK`, zero omissions. Also holds 36 cells + 2 baselines from `kimi` (K2.6), all `ERROR 400 model_retired`: the backend was retired between the probe and the run. They are kept because they exposed two analysis defects (K2.6 matched as the K3 positive; an `ERROR` baseline read as a failed one), and a run tidied after the fact is no longer a run. |
| `2026-10-04T07-13-24-059Z` | 4-cell K3 smoke test (`kimi-k3`, `L1`/`L2`, 1 rep), run after the amendment and before the K3 grid. All `OK`. Confirms that `reasoning_content` comes back and is sent back. |
| `2026-10-04T07-14-52-042Z` | **Slice 0.5, K3 arm.** `kimi-k3` × `MUX`/`SPLIT` × `L1`–`L6` × 6 reps. 72 cells, all `OK`, **0/24 `MUX` `create` omissions: K1 fires**. `../FINDINGS-SLICE0.5.md` § The K3 arm. |
| `2026-10-04T08-04-48-311Z` | 4-cell Slice 0.6 smoke test (`OH`/`BASE`, `L1`/`L7`, 1 rep). All `OK`. Confirms that K3 uses the injected `summary`/`security_risk` fields under `OH`. |
| `2026-10-04T08-06-21-880Z` | **Slice 0.6, Stage 1.** OpenHands surface (`OH`) vs `BASE`, 5 tasks × 6 reps on K3. **0/30 vs 0/30 first-create omission: not reproduced**, so Stage 2 did not run. `../FINDINGS-SLICE0.6.md`. |
| `2026-10-04T08-46-50-167Z` | 1-cell Slice 0.7 smoke test (`OH`/X1). Confirms that the target situation is reachable: first `create` at turn 10 after 21,480 characters. No omission. |
| `2026-10-04T08-52-59-998Z` | **Aborted** Slice 0.7 grid (`OH`+`BASE`), stopped by hand after 2 cells when the per-cell cost was found to be about ¥1.5–2. Both cells non-omitting. **Excluded** from analysis, per the budget amendment `8d8a0c3`, which discloses them. |
| `2026-10-04T09-10-10-983Z` | **Slice 0.7, `OH` arm.** 4 long-brief tasks × 4 reps, concurrency 4. **0/14 first-create omission, target situation reached 14/14: not reproduced.** 2 `X3` cells `ERROR` (300 s timeout). `../FINDINGS-SLICE0.7.md`. |
| `2026-10-04T09-48-46-395Z` | Slice 0.8 smoke test, 1 prefix replay. Only `summary.json` is public; the raw replay is in git-ignored `runs-private/` because it contains benchmark content. |
| `2026-10-04T09-49-26-352Z` | **Slice 0.8, prefix replay.** 26 replays (20 omission prefixes, 6 controls) on first-party K3. **0/13 omission among `create` replies: content does not reproduce it.** Public: `summary.json` (ids, classes, tokens). Raw: `runs-private/` (git-ignored). `../FINDINGS-SLICE0.8.md`. |
| `identity-probe.json` | Endpoint identity probe: 8 deterministic prompts to both DeepSeek serving paths. 6/7 byte-identical, 1 divergent. |

Three runs are deliberately absent: one contaminated by a gateway outage (52 ERROR cells in
113) before bounded retry existed, one produced by the harness whose parallel-call bug 400'd
the native form, and one aborted mid-flight. A run kept only because it was expensive is a run
that will eventually be quoted.

Nothing here is edited after the fact: a trace that gets tidied is no longer a trace. Outcome
codes may be *recomputed* — `node analyze.js` re-scores persisted cells with the current
classifier and prints every cell whose code moved. But a **parser** change is different: it
changes what the model sees next, so it changes the trajectory and not merely the score. That
is why the first Slice 0.2 run was re-run rather than re-scored.
