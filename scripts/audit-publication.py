"""Fail before publication if reachable Git blobs contain credentials/private files.

Only paths/counts are printed, never matched secret values. This is a focused
release check, not a replacement for a complete security audit.
"""
import json
import re
import subprocess
from pathlib import Path

root=Path(__file__).resolve().parents[1]
git=['git','-c',f'safe.directory={root.as_posix()}']
def run(*args):return subprocess.check_output(git+list(args),cwd=root)
objects=run('rev-list','--objects','--all').decode().splitlines()
paths={line.split(' ',1)[0]:line.split(' ',1)[1] for line in objects if ' ' in line}
patterns=[re.compile(p) for p in (
    rb'\bsk-[A-Za-z0-9_-]{24,}',rb'\bgh[pousr]_[A-Za-z0-9]{25,}',
    rb'github_pat_[A-Za-z0-9_]{30,}',rb'-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----')]
blocked=[];scanned=0
process=subprocess.Popen(git+['cat-file','--batch'],cwd=root,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
try:
    for oid,name in paths.items():
        process.stdin.write((oid+'\n').encode());process.stdin.flush()
        header=process.stdout.readline().split()
        if len(header)!=3:raise RuntimeError('Unexpected Git object response')
        size=int(header[2]);content=process.stdout.read(size);process.stdout.read(1)
        if header[1]!=b'blob':continue
        scanned+=1
        private=any(part in {'local-data','data','node_modules','.venv','tmp','test-results','release'} for part in Path(name).parts)
        private=private or name.lower().endswith(('.pdf','.sqlite','.db','.gguf','.env'))
        if private or any(p.search(content) for p in patterns):blocked.append(name)
finally:
    process.stdin.close();process.wait()
report={'commit':run('rev-parse','HEAD').decode().strip(),'reachableBlobsScanned':scanned,'blockedPaths':sorted(set(blocked))}
(root/'tmp').mkdir(exist_ok=True)
(root/'tmp/publication-audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
if blocked:raise SystemExit(1)
