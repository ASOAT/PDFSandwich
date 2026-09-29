"""Exercise the real offline PDF pipeline, without credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / 'backend'))
from pdf_ops import extract_page
folder = root / 'tmp' / 'local-translation'
folder.mkdir(parents=True, exist_ok=True)
extract_page(str(root / 'tmp/pdfs/reading-sample.pdf'), 0, str(folder / 'source.pdf'))
request = {'input': str(folder/'source.pdf'), 'output': str(folder/'zh.pdf'),
           'modelDir': str(root/'local-data/models'), 'settings': {'provider':'local'}}
command = [os.environ['PDFSANDWICH_WORKER'], '--translate'] if os.environ.get('PDFSANDWICH_WORKER') else [sys.executable, '-u', str(root/'backend/worker.py'), '--translate']
child = subprocess.Popen(command,
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=(folder/'diagnostic.log').open('w',encoding='utf-8'),
    text=True, encoding='utf-8', cwd=folder)
child.stdin.write(json.dumps(request)+'\n'); child.stdin.close()
for line in child.stdout:
    print(line.strip(), flush=True)
sys.exit(child.wait())
