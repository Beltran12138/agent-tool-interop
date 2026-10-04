# For each (benchmark, model): best vs runner-up harness, paired task-level diff,
# exact sign test on discordant tasks, and bootstrap (over tasks) argmax stability.
# Captures task-sampling variance only; run-to-run variance is unmeasurable (1 run/task).
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
os.chdir(DATA)
import pandas as pd, numpy as np
from math import comb
d = pd.read_csv('results/task_level.tsv', sep='\t')
rng = np.random.default_rng(0)
rows = []
for (b, m), g in d.groupby(['benchmark', 'model']):
    w = g.pivot(index='task_id', columns='harness', values='reward')
    means = w.mean().sort_values(ascending=False)
    h1, h2 = means.index[0], means.index[1]
    diff = w[h1] - w[h2]
    pos, neg = int((diff > 0).sum()), int((diff < 0).sum())
    n = pos + neg
    k = min(pos, neg)
    p = min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2**n) if n else 1.0
    idx = rng.integers(0, len(w), size=(5000, len(w)))
    arr = w.values
    wins = np.bincount(np.nanargmax(arr[idx].mean(axis=1), axis=1), minlength=arr.shape[1])
    stab = wins[list(w.columns).index(h1)] / 5000
    rows.append(dict(bench=b, model=m, best=h1, runner_up=h2, lead_pts=round(100*(means.iloc[0]-means.iloc[1]), 2),
                     tasks_better=pos, tasks_worse=neg, sign_p=round(p, 3), boot_argmax_stable=round(stab, 3)))
r = pd.DataFrame(rows)
print(r.to_string(index=False))
r.to_csv(OUT + '/argmax_stability.csv', index=False)
