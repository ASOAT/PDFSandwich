"""Publish a prepared, reviewed release using local Git Credential Manager.

The explicit --publish flag changes repository visibility and publishes assets.
Without it this only reads repository/release/Pages state. Tokens remain in
memory, are restricted to GitHub API hosts, and are never printed or saved.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT=Path(__file__).resolve().parents[1]
REPO='/repos/ASOAT/PDFSandwich'


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--publish',action='store_true')
    parser.add_argument('--version',default=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))['version'])
    options=parser.parse_args()
    result=subprocess.run(['git','credential','fill'],input='protocol=https\nhost=github.com\n\n',
        text=True,capture_output=True,env={**os.environ,'GIT_TERMINAL_PROMPT':'0','GCM_INTERACTIVE':'never'},timeout=30)
    credentials=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    token=credentials.get('password')
    if not token:raise RuntimeError('GitHub authentication required')
    headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json',
             'X-GitHub-Api-Version':'2022-11-28','User-Agent':'PDFSandwich-release'}
    def api(endpoint,data=None,method=None):
        request=urllib.request.Request('https://api.github.com'+endpoint,
            data=json.dumps(data).encode() if data is not None else None,
            headers={**headers,'Content-Type':'application/json'},method=method)
        with urllib.request.urlopen(request,timeout=60) as response:
            body=response.read();return json.loads(body) if body else {}
    account=api('/user')['login']
    if account.casefold()!='asoat':raise RuntimeError('Unexpected GitHub account')
    repo=api(REPO)
    tag='v'+options.version
    try:release=api(REPO+'/releases/tags/'+tag)
    except urllib.error.HTTPError as error:
        if error.code!=404:raise
        release=None
    if options.publish:
        audit=json.loads((ROOT/'tmp/publication-audit.json').read_text())
        if audit['blockedPaths']:raise RuntimeError('Publication audit failed')
        commit=subprocess.check_output(['git','-c',f'safe.directory={ROOT.as_posix()}','rev-parse','HEAD'],cwd=ROOT).decode().strip()
        if audit.get('commit')!=commit:raise RuntimeError('Publication audit is stale')
        if api(REPO+'/git/ref/heads/main')['object']['sha']!=commit:raise RuntimeError('Push the verified release commit before publishing')
        if not (ROOT/'LICENSE').exists():raise RuntimeError('Project license missing')
        directory=ROOT/'release'/options.version
        notes=(ROOT/'docs'/f'release-{options.version}.md').read_text(encoding='utf-8')
        assets=[(directory/f'PDFSandwich-Setup-{options.version}.exe',f'PDFSandwich-Setup-{options.version}.exe'),
                (directory/f'PDFSandwich-Setup-{options.version}.exe.blockmap',f'PDFSandwich-Setup-{options.version}.exe.blockmap'),
                (directory/'latest.yml','latest.yml'),
                (directory/f'PDFSandwich-{options.version}-source.zip',f'PDFSandwich-{options.version}-source.zip'),
                (directory/'SHA256SUMS.txt','SHA256SUMS.txt'),
                (ROOT/'tmp/pdfs/release-sample.pdf','PDFSandwich-demo.pdf')]
        assets.append((directory/f'PDFSandwich-Obsidian-{options.version}.zip',f'PDFSandwich-Obsidian-{options.version}.zip'))
        for file,_ in assets:
            if not file.is_file():raise RuntimeError(f'Missing release asset: {file.name}')
        sums=dict(line.split('  ',1)[::-1] for line in (directory/'SHA256SUMS.txt').read_text().splitlines() if line)
        for file,name in assets:
            if name=='SHA256SUMS.txt':continue
            with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if sums.get(name)!=digest:raise RuntimeError(f'SHA256SUMS mismatch: {name}')
        import yaml
        manifest=yaml.safe_load((directory/'latest.yml').read_text(encoding='utf-8'))
        if manifest.get('version')!=options.version:raise RuntimeError('Updater metadata version mismatch')
        import base64
        for entry in manifest['files']:
            if entry['url']!=f'PDFSandwich-Setup-{options.version}.exe':raise RuntimeError('Unexpected update filename')
            installer=directory/entry['url']
            with installer.open('rb') as stream:digest=base64.b64encode(hashlib.file_digest(stream,'sha512').digest()).decode()
            if digest!=entry['sha512'] or installer.stat().st_size!=entry['size']:raise RuntimeError('Updater metadata checksum mismatch')
        with zipfile.ZipFile(directory/f'PDFSandwich-{options.version}-source.zip') as source:
            manifest=json.loads(source.read(f'PDFSandwich-{options.version}/dependency-sources/manifest.json'))
            if manifest['projectCommit']!=commit:raise RuntimeError('Source bundle is stale')
        if not release:
            release=api(REPO+'/releases',{'tag_name':tag,'target_commitish':'main','name':f'PDFSandwich {options.version}',
                                         'body':notes,'draft':True,'prerelease':False})
        existing={item['name']:item for item in api(REPO+f"/releases/{release['id']}/assets")}
        upload=urllib.parse.urlparse(release['upload_url'].split('{')[0])
        if upload.hostname!='uploads.github.com':raise RuntimeError('Unexpected GitHub upload host')
        for file,name in assets:
            with file.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
            if name in existing:
                remote=existing[name]
                if remote.get('size')!=file.stat().st_size or remote.get('digest')!='sha256:'+digest:
                    raise RuntimeError(f'Existing asset differs: {name}')
                print(json.dumps({'verifiedAsset':name}),flush=True);continue
            connection=http.client.HTTPSConnection(upload.hostname,timeout=600)
            try:
                connection.putrequest('POST',upload.path+'?name='+urllib.parse.quote(name))
                for key,value in {**headers,'Content-Type':'application/octet-stream','Content-Length':str(file.stat().st_size)}.items():connection.putheader(key,value)
                connection.endheaders()
                with file.open('rb') as stream:
                    while chunk:=stream.read(1024*1024):connection.send(chunk)
                response=connection.getresponse();body=response.read()
                if response.status!=201:raise RuntimeError(f'Asset upload returned HTTP {response.status}')
                asset=json.loads(body)
                if asset.get('size')!=file.stat().st_size:raise RuntimeError('Uploaded asset size mismatch')
                if asset.get('digest') and asset['digest']!='sha256:'+digest:raise RuntimeError('Uploaded asset checksum mismatch')
                print(json.dumps({'uploaded':name,'bytes':asset['size']}),flush=True)
            finally:connection.close()
        # Upload all installer, blockmap, and channel files before publishing the draft.
        repo=api(REPO,{'visibility':'public','homepage':'https://asoat.github.io/PDFSandwich/',
                       'description':'Windows bilingual PDF reader with offline translation, preserved formulas and synchronized annotations.'},'PATCH')
        release=api(REPO+f"/releases/{release['id']}",{'draft':False,'body':notes,'make_latest':'true'},'PATCH')
        try:pages=api(REPO+'/pages')
        except urllib.error.HTTPError as error:
            if error.code!=404:raise
            pages=api(REPO+'/pages',{'source':{'branch':'main','path':'/docs'},'build_type':'legacy'})
        if pages.get('source')!={'branch':'main','path':'/docs'}:
            api(REPO+'/pages',{'source':{'branch':'main','path':'/docs'},'build_type':'legacy'},'PUT')
    try:pages=api(REPO+'/pages')
    except urllib.error.HTTPError as error:pages={'httpStatus':error.code}
    print(json.dumps({'repository':repo['html_url'],'private':repo['private'],
                      'release':release['html_url'] if release else None,
                      'draft':release['draft'] if release else None,
                      'pages':{k:pages.get(k) for k in ('html_url','status','source','httpStatus')}},ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except urllib.error.HTTPError as error:
        print(json.dumps({'error':'GitHub API request failed','httpStatus':error.code}));raise SystemExit(1)
