"""Create the optional Obsidian Companion release asset from reviewed source."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
directory=root/'release'/version;directory.mkdir(parents=True,exist_ok=True)
output=directory/f'PDFSandwich-Obsidian-{version}.zip'
with ZipFile(output,'w',ZIP_DEFLATED) as archive:
    for name in ['manifest.json','main.js','styles.css','README.md']:
        archive.write(root/'obsidian-plugin'/name,'pdfsandwich-companion/'+name)
    archive.write(root/'LICENSE','pdfsandwich-companion/LICENSE')
print(output)
