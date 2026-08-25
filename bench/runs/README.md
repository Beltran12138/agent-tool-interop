# Run index

| run | what it is |
|---|---|
| `2026-08-25T07-37-34-492Z` | single-cell smoke test (ds-direct / S1 / T1) while wiring the loop up |
| `2026-08-25T07-37-48-079Z` | 4-cell smoke test on reasoning models. **Pre-fix state**: `grid_minimax_S4_T3` shows the strict-dialect parser producing `args: {}` and an argument-validation failure on a structurally valid call, and shows the 120 s timeout firing on Kimi. Kept because it is the evidence for two of the fixes described in `../FINDINGS-SLICE0.md`. |
| `2026-08-25T07-44-29-649Z` | **Slice 0.** The run reported in `../FINDINGS-SLICE0.md`. 72 cells. |

Later runs supersede earlier ones only where they say so. Nothing here is edited after the
fact: a trace that gets tidied is no longer a trace.
