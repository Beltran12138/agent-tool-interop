# Kimi K3: openJiuwen lead under (a) paper scoring, (b) dropping tasks where EITHER side ended in
# a transport/provider error (paired), (c) counting transport-terminal runs as missing on that side only.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
os.chdir(DATA)
import pandas as pd
from math import comb
d = pd.read_csv(OUT + '/census.csv')
def sign_p(p, n):
    N = p + n; k = min(p, n)
    return min(1.0, 2 * sum(comb(N, i) for i in range(k + 1)) / 2**N) if N else 1.0
out = []
for b in ['TUA-Bench', 'ALE-CLI', 'Terminal-Bench 4']:
    g = d[(d.bench == b) & (d.model == 'Kimi K3')]
    R = g.pivot(index='task', columns='harness', values='reward')
    T = g.pivot(index='task', columns='harness', values='transport_terminal').astype(bool)
    for h in [c for c in R.columns if c != 'openJiuwen']:
        keep = ~(T['openJiuwen'] | T[h])
        x = (R['openJiuwen'] - R[h])
        xa, xb = x, x[keep]
        out.append(dict(bench=b, vs=h,
            lead_paper=round(100 * xa.mean(), 2), w_l_paper=f"{(xa>0).sum()}-{(xa<0).sum()}", p_paper=round(sign_p((xa>0).sum(), (xa<0).sum()), 3),
            dropped=int((~keep).sum()), oj_tt=int(T['openJiuwen'].sum()), other_tt=int(T[h].sum()),
            lead_clean=round(100 * xb.mean(), 2), w_l_clean=f"{(xb>0).sum()}-{(xb<0).sum()}", p_clean=round(sign_p((xb>0).sum(), (xb<0).sum()), 3),
            other_score_clean=round(100 * R[h][keep].mean(), 2), oj_score_clean=round(100 * R['openJiuwen'][keep].mean(), 2)))
r = pd.DataFrame(out); print(r.to_string(index=False)); r.to_csv(OUT + '/kimi_reanalysis.csv', index=False)
