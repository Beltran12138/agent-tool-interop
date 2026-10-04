import json, sys
W = sys.argv[1]
s = open('oh_tools.json').read()
for v in {W, W.replace('\\', '/'), json.dumps(W)[1:-1]}:
    s = s.replace(v, '/workspace')
t = json.loads(s)
json.dump(t, open('oh_tools.json', 'w'), indent=1)
for x in t:
    f = x['function']; p = f['parameters']
    print(f['name'], 'desc', len(f['description']), 'params', list(p.get('properties', {})), 'required', p.get('required'))
fe = [x for x in t if x['function']['name'] == 'file_editor'][0]['function']['parameters']['properties']
print(json.dumps({k: fe[k] for k in ['security_risk', 'summary', 'file_text']}, indent=1)[:1500])
print('leftover wsdir?', 'wsdir' in s)
