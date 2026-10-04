# right-fit: secondary analysis of arXiv:2610.00917

Scripts behind [`../../docs/OPEN-CODING-02-right-fit.md`](../../docs/OPEN-CODING-02-right-fit.md).
They read the released trajectories of *Finding the Right Fit* (Li et al., 2026) and make no
model calls.

```
pip install pandas numpy
python fetch.py               # ~430 MB into ./data (or set RF_DATA to an existing copy)
python census.py              # one row per run -> out/census.csv (run this first)
python argmax_stability.py    # best vs runner-up harness: sign test + bootstrap   (§3.1)
python kimi_reanalysis.py     # Kimi leads with transport-terminal tasks removed   (§3.2)
python providers.py           # provider names in error events, by batch            (§3.3)
python kimi_openhands.py      # argument errors, stuck-detector check, recovery    (§3.4–3.6)
```

The dataset is CC BY-NC 4.0 and asks that it not be used for training. `data/` and `out/` are
git-ignored, so only code and the summary numbers in the findings document live in this
repository.
