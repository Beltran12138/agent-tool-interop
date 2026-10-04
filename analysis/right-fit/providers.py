# Which upstream providers are named in error events, per configuration, and in which batch.
# The study pins every model to its first-party provider with fallbacks disabled
# (experiment.yaml: provider_only, allow_fallbacks: false). This checks the error text against that.
import os
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
os.chdir(DATA)
import gzip, json, glob, re, collections

names = collections.Counter()
for f in sorted(glob.glob('trajectories/*/*/*.jsonl.gz')):
    for line in gzip.open(f, 'rt', encoding='utf-8'):
        r = json.loads(line)
        found = set()
        for e in r['harness_events'] or []:
            s = e.get('detail', '')
            for m in re.finditer(r'provider_name|Upstream error from', s):
                frag = re.sub(r'[\\"\s:\']+', ' ', s[m.start():m.start() + 60])
                frag = frag.replace('provider_name ', '').replace('Upstream error from ', 'upstream-error ')
                found.add(' '.join(frag.split()[:3]).rstrip(',.}'))
        for x in found:
            names[(r['benchmark'], r['harness'], r['model'], x)] += 1
print('runs naming a provider in an error event (bench, harness, model, provider fragment):')
for k, v in sorted(names.items()):
    print(f'{v:4d}', k)

print('\nKimi K3 / PI / Terminal-Bench 4, by batch (source.run_id) and provider named:')
c = collections.Counter()
for line in gzip.open('trajectories/terminal-bench-4/pi/kimi-k3.jsonl.gz', 'rt', encoding='utf-8'):
    r = json.loads(line)
    s = ' '.join(e['detail'] for e in r['harness_events'])
    tag = 'Sail Research' if 'Sail Research' in s else 'Morph' if 'Morph' in s else 'Moonshot AI' if 'Moonshot' in s else '-'
    c[(r['source']['run_id'], tag)] += 1
for k, v in sorted(c.items()):
    print(f'{v:4d}', k)
