"""Bundle project/build sources and exact AGPL dependency source distributions."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.request
import zipfile

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
cache=root/'tmp/dependency-sources';cache.mkdir(parents=True,exist_ok=True)
sources=[
 ('pymupdf-1.25.2.tar.gz','https://files.pythonhosted.org/packages/40/fc/dd8776dc5c2f8cf0e51cf81a5f1de3840996bed7ca03ec768b0733024fb9/pymupdf-1.25.2.tar.gz','9ea88ff1b3ccb359620f106a6fd5ba6877d959d21d78272052c3496ceede6eec'),
 ('babeldoc-0.6.2.tar.gz','https://files.pythonhosted.org/packages/5e/2b/e0f23e7fde25a7d9b90ff219ca60c220105552ec96f290a5dfaadabe4590/babeldoc-0.6.2.tar.gz','b2b2769aa9f8372b35071b46788da531ebb58bc3cf31ab4dbb5deb06e9424026'),
 ('pdf2zh_next-2.9.0.tar.gz','https://files.pythonhosted.org/packages/87/5e/d971946ec7ad3e0b0aeada46e323485e7b2fb29ed5285b0d854e285b9d8d/pdf2zh_next-2.9.0.tar.gz','cadd8380eb8b3c06427f04e4c4a3a3bafc56a2a6b5e2293f9b5ad07c3c3011dd'),
 ('mupdf-1.25.2-source.tar.gz','https://mupdf.com/downloads/archive/mupdf-1.25.2-source.tar.gz','36ccf6a5e691e188acf8db6e98d08bf05f27bb4ce30432dc15fc76d329a92d4d'),
]
for name,url,digest in sources:
    file=cache/name
    if not file.exists():
        partial=file.with_suffix('.partial')
        with urllib.request.urlopen(url,timeout=120) as response,partial.open('wb') as stream:
            while chunk:=response.read(1024*1024):stream.write(chunk)
        partial.replace(file)
    with file.open('rb') as stream:
        if hashlib.file_digest(stream,'sha256').hexdigest()!=digest:raise RuntimeError(f'Source checksum failed: {name}')
    print('Verified '+name,flush=True)
# PyMuPDF's PyPI sdist downloads MuPDF at build time, so bundle it separately.
with tarfile.open(cache/sources[3][0]) as archive:
    names=archive.getnames()
    if not any('/source/fitz/' in n for n in names) or not any('/thirdparty/freetype/' in n for n in names):
        raise RuntimeError('MuPDF native source tree is incomplete')
git=['git','-c',f'safe.directory={root.as_posix()}']
if subprocess.check_output(git+['status','--porcelain'],cwd=root).strip():
    raise RuntimeError('Commit the complete release tree before generating its source bundle')
tracked=subprocess.check_output(git+['ls-files','-z'],cwd=root).decode().split('\0')
commit=subprocess.check_output(git+['rev-parse','HEAD'],cwd=root).decode().strip()
directory=root/'release'/version;directory.mkdir(parents=True,exist_ok=True)
target=directory/f'PDFSandwich-{version}-source.zip'
prefix=f'PDFSandwich-{version}'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as bundle:
    for name in sorted(set(tracked)):
        if name and (root/name).is_file():bundle.write(root/name,f'{prefix}/{name}')
    for name,_,_ in sources:bundle.write(cache/name,f'{prefix}/dependency-sources/{name}',compress_type=zipfile.ZIP_STORED)
    bundle.writestr(f'{prefix}/dependency-sources/manifest.json',json.dumps({'projectCommit':commit,'sources':[{'file':n,'url':u,'sha256':h} for n,u,h in sources]},indent=2))
    bundle.writestr(f'{prefix}/dependency-sources/README.txt',
        'Exact upstream source distributions for the bundled AGPL components.\n'
        'MuPDF native sources are bundled separately alongside PyMuPDF.\n'
        'The project README gives the Windows build commands and pinned dependency locks.\n'
        'scripts/patch-layout.py applies the two BabelDOC import substitutions.\n'
        'backend/layout_runtime.py, layout_preservation.py and reference_layout.py apply\n'
        'the documented per-page runtime adapters; their complete source is included.\n'
        'Model weights and llama.cpp are downloaded separately and are not in the installer.\n')
print(json.dumps({'sourceBundle':str(target),'bytes':target.stat().st_size}),flush=True)

# Keep manual downloads and the updater's metadata in one verified release set.
artifacts=[(directory/f'PDFSandwich-Setup-{version}.exe',f'PDFSandwich-Setup-{version}.exe'),
           (directory/f'PDFSandwich-Setup-{version}.exe.blockmap',f'PDFSandwich-Setup-{version}.exe.blockmap'),
           (directory/'latest.yml','latest.yml'),(target,target.name),
           (root/'tmp/pdfs/release-sample.pdf','PDFSandwich-demo.pdf')]
artifacts.append((directory/f'PDFSandwich-Obsidian-{version}.zip',f'PDFSandwich-Obsidian-{version}.zip'))
checksums=[]
for file,name in artifacts:
    with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
    checksums.append(f'{digest}  {name}')
(directory/'SHA256SUMS.txt').write_text('\n'.join(checksums)+'\n',encoding='utf-8')
print('Generated SHA256SUMS.txt for installer, source, updater metadata and demo.',flush=True)
