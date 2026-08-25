# Run index

| run | what it is |
|---|---|
| `2026-08-25T07-37-34-492Z` | single-cell smoke test (ds-direct / S1 / T1) while wiring the loop up |
| `2026-08-25T07-37-48-079Z` | 4-cell smoke test on reasoning models. **Pre-fix state**: `grid_minimax_S4_T3` shows the strict-dialect parser producing `args: {}` and an argument-validation failure on a structurally valid call, and shows the 120 s timeout firing on Kimi. Kept because it is the evidence for two of the fixes described in `../FINDINGS-SLICE0.md`. |
| `2026-08-25T07-44-29-649Z` | **Slice 0.** 72 cells. Reported in `../FINDINGS-SLICE0.md`. |
| `2026-08-25T09-04-29-292Z` | **Slice 0.1.** 116 cells, 0 ERROR. Reported in `../FINDINGS-SLICE0.1.md`. |

Two Slice 0.1 runs are deliberately absent:

- one was contaminated by an upstream gateway outage (52 ERROR cells in 113) before bounded
  retry existed
- one was produced by the pre-fix harness, whose parallel-call bug 400'd the native form on
  the chain task

Both were discarded rather than reported. A run kept only because it was expensive is a run
that will eventually be quoted.

Nothing here is edited after the fact: a trace that gets tidied is no longer a trace. Outcome
codes, however, may be *recomputed* — `node analyze.js` re-scores persisted cells with the
current classifier and prints every cell whose code moved, so a rule change never requires
re-running a cell to change a number.
