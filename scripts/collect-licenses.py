"""Collect installed dependency notices for the locally built distribution."""
import importlib.metadata as metadata
import json
from pathlib import Path
import shutil
root=Path(__file__).resolve().parents[1]
destination=root/'build-resources/licenses';destination.mkdir(parents=True,exist_ok=True)
inventory=[]
for package in metadata.distributions():
    name=package.metadata['Name'];version=package.version
    inventory.append({'name':name,'version':version,'ecosystem':'python','license':package.metadata.get('License-Expression') or package.metadata.get('License',''),'homepage':package.metadata.get('Home-page','')})
    for item in package.files or []:
        if any(part.lower().startswith(('license','copying','notice')) for part in item.parts) and '.dist-info' in str(item):
            file=Path(package.locate_file(item))
            if file.is_file():
                target=destination/'python'/name/str(item);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
folders=[]
for folder in (root/'node_modules').iterdir():
    if folder.is_dir():folders.extend(folder.iterdir() if folder.name.startswith('@') else [folder])
for folder in folders:
    manifest=folder/'package.json'
    if not manifest.is_file():continue
    pkg=json.loads(manifest.read_text(encoding='utf-8'));name=pkg.get('name',folder.name)
    inventory.append({'name':name,'version':pkg.get('version'),'ecosystem':'npm','license':pkg.get('license',''),'homepage':pkg.get('homepage','')})
    for file in folder.iterdir():
        if file.is_file() and file.name.lower().startswith(('license','copying','notice')):
            target=destination/'npm'/name.replace('/','__')/file.name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(file,target)
(destination/'inventory.json').write_text(json.dumps(inventory,ensure_ascii=False,indent=2),encoding='utf-8')
shutil.copyfile(root/'THIRD_PARTY_NOTICES.md',destination/'THIRD_PARTY_NOTICES.md')
shutil.copyfile(root/'LICENSE',destination/'PDFSandwich-LICENSE.txt')
(destination/'SOURCE.txt').write_text('PDFSandwich source and exact AGPL dependency source distributions:\nhttps://github.com/ASOAT/PDFSandwich/releases\nBuild instructions and pinned dependency versions are included in the source archive.\n',encoding='utf-8')
print(f'Collected notices for {len(inventory)} installed build/runtime dependencies.')

shutil.copytree(root/'licenses',destination/'models',dirs_exist_ok=True)

shutil.copytree(root/'backend/formula_runtime',destination/'formula-runtime',ignore=shutil.ignore_patterns('*.py','*.pyc','__pycache__','config.yaml'),dirs_exist_ok=True)
