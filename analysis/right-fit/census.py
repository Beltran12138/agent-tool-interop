# One row per scored run. Classifies how the run ended and what the tool calls looked like.
# Reads only the released trajectories; no model calls.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
OUT = os.path.join(HERE, 'out'); os.makedirs(OUT, exist_ok=True)
os.chdir(DATA)
import gzip, json, glob, re, sys
import pandas as pd

TRANSPORT = re.compile(
    r'stream ended unexpectedly|Network connection lost|terminated$|Request timed out|Overloaded|'
    r'idle timeout|Upstream idle|Provider returned error|Provider finish_reason: error|'
    r'temporarily rate-limited|RATE_LIMIT|TRANSPORT|SERVER \d|exceed your available credits|'
    r'stream frame timeout|ReadError|APIError|APIStatusError|Error code: 5\d\d|Error code: 429|'
    r'Error code: 413|PermissionDeniedError|\b5\d\d\b|\b403\b', re.I)
ERR_TYPES = {'assistant_error', 'model_error', 'turn_end', 'llm_retry', 'context_compaction_failed'}
ARGERR = re.compile(r'is required|Missing required|missing \d* ?required|Invalid (?:argument|parameter|input)|'
                    r'validation error|Field required|Unknown (?:parameter|argument)|unexpected keyword|'
                    r'Failed to parse|not valid JSON|JSONDecodeError|invalid_type', re.I)
TOOLSHAPED = re.compile(r'<tool_call>|<\|tool_call|<function=|"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"|'
                        r'functions\.[a-z_]+:\d|<invoke name=', re.I)
SUB = re.compile(r'(\d+) of (\d+) responses served by (\S+)')

rows = []
for f in sorted(glob.glob('trajectories/*/*/*.jsonl.gz')):
    for line in gzip.open(f, 'rt', encoding='utf-8'):
        r = json.loads(line)
        M = r.get('messages') or []
        ev = r.get('harness_events') or []
        last_asst = max([i for i, m in enumerate(M) if m['role'] == 'assistant'], default=-1)
        terr = [e for e in ev if e['type'] in ERR_TYPES and TRANSPORT.search(e.get('detail', ''))
                and (e.get('index') or 0) >= last_asst]
        anyerr = [e for e in ev if e['type'] in ERR_TYPES and TRANSPORT.search(e.get('detail', ''))]
        sub = [SUB.search(e['detail']) for e in ev if e['type'] == 'model_substitution']
        sub = [s for s in sub if s]
        n_calls = n_badjson = n_argerr = n_shaped = 0
        vis = 0
        tool_id_result = {m.get('tool_call_id'): (m.get('content') or '') for m in M if m['role'] == 'tool'}
        for m in M:
            if m['role'] != 'assistant':
                continue
            vis += len(m.get('content') or '') + len(m.get('reasoning') or '')
            tcs = m.get('tool_calls') or []
            if not tcs and TOOLSHAPED.search(m.get('content') or ''):
                n_shaped += 1
            for tc in tcs:
                n_calls += 1
                a = tc.get('arguments') or ''
                vis += len(a)
                try:
                    json.loads(a) if a else {}
                except Exception:
                    n_badjson += 1
                res = tool_id_result.get(tc.get('id'), '')
                if ARGERR.search(res[:400]):
                    n_argerr += 1
        rows.append(dict(
            bench=r['benchmark'], harness=r['harness'], model=r['model'], task=r['task_id'],
            reward=r['reward'], status=r['reward_status'], traj=r['trajectory_available'],
            out_tok=(r.get('usage') or {}).get('output_tokens'), vis_chars=vis,
            transport_terminal=bool(terr), transport_any=bool(anyerr),
            transport_detail=(terr[-1]['detail'][:120] if terr else ''),
            stuck=any(e['type'] == 'stuck_detector' for e in ev),
            timeout=any(e['type'] == 'timeout' for e in ev),
            substituted=bool(sub), sub_frac=(int(sub[0].group(1)) / int(sub[0].group(2)) if sub else 0.0),
            sub_model=(sub[0].group(3) if sub else ''),
            sail=any('Sail Research' in (e.get('detail') or '') for e in ev),
            n_calls=n_calls, n_badjson=n_badjson, n_argerr=n_argerr, n_toolshaped_text=n_shaped,
        ))
d = pd.DataFrame(rows)
d.to_csv(OUT + '/census.csv', index=False)
print(len(d), 'runs')
