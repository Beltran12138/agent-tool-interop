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
