# Download the released results and trajectories of arXiv:2610.00917 into ./data (about 430 MB).
# Sizes are checked against the Hugging Face tree listing; re-running skips complete files.
import json, os, subprocess, urllib.request
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get('RF_DATA', os.path.join(HERE, 'data'))
REPO = 'yixuanli97/finding-the-right-fit'
tree = json.load(urllib.request.urlopen(f'https://huggingface.co/api/datasets/{REPO}/tree/main?recursive=true'))
for x in tree:
    p = x['path']
    if x['type'] != 'file' or not p.startswith(('results/', 'trajectories/')):
        continue
    dst = os.path.join(DATA, p)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    if os.path.exists(dst) and os.path.getsize(dst) == x['size']:
        continue
    subprocess.run(['curl', '-sL', '--retry', '3', '-o', dst, f'https://huggingface.co/datasets/{REPO}/resolve/main/{p}'], check=True)
    print('ok' if os.path.getsize(dst) == x['size'] else 'SIZE MISMATCH', p, flush=True)
