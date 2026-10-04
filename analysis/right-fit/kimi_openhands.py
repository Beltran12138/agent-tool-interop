# Kimi K3 under OpenHands: what the "malformed tool calls" are, whether the stuck detector fired on
# real invocations (the OPEN-CODING-01 E1 lesson), and what the model did after each argument error.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
os.chdir(DATA)
import gzip, json, glob, re, collections


def load(path):
    for line in gzip.open(path, 'rt', encoding='utf-8'):
        yield json.loads(line)


def calls_of(r):
    M = r['messages']
    res = {m.get('tool_call_id'): (m.get('content') or '') for m in M if m['role'] == 'tool'}
    out = []
    for m in M:
        if m['role'] != 'assistant':
            continue
        for t in m.get('tool_calls') or []:
            try:
                A = json.loads(t.get('arguments') or '{}')
            except Exception:
                A = None
            out.append((t['name'], A, res.get(t.get('id'), '')))
    return out


# 1. Error messages behind the argument errors
msgs = collections.Counter()
creates = collections.Counter()
for f in glob.glob('trajectories/*/openhands/kimi-k3.jsonl.gz'):
    for r in load(f):
        for n, A, res in calls_of(r):
            if re.search(r'is required', res[:200]):
                msgs[(n, re.sub(r'^\[An error occurred during execution\.\]\s*', '', res[:200]).strip()[:80])] += 1
            if n == 'file_editor' and isinstance(A, dict) and A.get('command') == 'create':
                creates['with file_text' if 'file_text' in A else 'without file_text'] += 1
print('1. argument-error messages (Kimi K3, OpenHands):')
for k, v in msgs.most_common(6):
    print(f'{v:5d}', k)
print('   file_editor create calls:', dict(creates))

# 2. E1 check: were the stuck-detector triggers real, identical invocations?
print('\n2. stuck-detector runs, last four assistant turns (all models, OpenHands):')
c = collections.Counter()
rewards = []
for f in glob.glob('trajectories/*/openhands/*.jsonl.gz'):
    for r in load(f):
        if not any(e['type'] == 'stuck_detector' for e in r['harness_events']):
            continue
        rewards.append(r['reward'])
        A = [m for m in r['messages'] if m['role'] == 'assistant'][-4:]
        kinds = '/'.join('call' if m.get('tool_calls') else ('text' if (m.get('content') or '').strip() else 'empty') for m in A)
        sigs = {json.dumps([(t['name'], t.get('arguments')) for t in m['tool_calls']]) for m in A if m.get('tool_calls')}
        last = [m for m in r['messages'] if m['role'] == 'tool'][-1:]
        lr = (last[0]['content'] or '') if last else ''
        c[(r['model'], kinds, 'identical' if len(sigs) == 1 else f'{len(sigs)} distinct',
           'argument error' if 'is required' in lr[:200] else 'other')] += 1
for k, v in c.most_common():
    print(f'{v:4d}', k)
print(f'   total {len(rewards)} runs; reward > 0 in {sum(x > 0 for x in rewards)}')

# 3. Recovery after an argument error (OPEN-CODING-01 D-codes)
rec = collections.Counter()
for f in glob.glob('trajectories/*/openhands/kimi-k3.jsonl.gz'):
    for r in load(f):
        cs = calls_of(r)
        for i, (n, A, res) in enumerate(cs):
            if not (n == 'file_editor' and 'is required for command' in res[:200]):
                continue
            if i + 1 == len(cs):
                k = 'run ends'
            else:
                n2, A2, res2 = cs[i + 1]
                if n2 == 'file_editor' and A2 == A:
                    k = 'D2 identical repeat'
                elif n2 == 'file_editor' and 'is required' in res2[:200]:
                    k = 'D2b changed arguments, still missing'
                elif n2 == 'file_editor':
                    k = 'D1 fixed, same tool'
                elif n2 == 'terminal':
                    k = 'D4 abandon tool for terminal'
                else:
                    k = 'other: ' + n2
            rec[k] += 1
print('\n3. next call after a file_editor argument error (Kimi K3, OpenHands):')
tot = sum(rec.values())
for k, v in rec.most_common():
    print(f'{v:5d}  {100 * v / tot:5.1f}%  {k}')
