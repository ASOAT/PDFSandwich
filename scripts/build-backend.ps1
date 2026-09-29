$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& .venv\Scripts\python.exe -m PyInstaller --noconfirm --name pdfsandwich-worker --distpath backend-dist --workpath tmp/pyinstaller --specpath tmp --paths backend --collect-all babeldoc --collect-all pdf2zh_next --collect-all onnxruntime --collect-all tiktoken --collect-all ctranslate2 --collect-all sentencepiece --collect-all bitstring --collect-all bitarray --hidden-import translate --hidden-import local_model --hidden-import pymupdf --hidden-import huggingface_hub --exclude-module pytest backend/worker.py
if ($LASTEXITCODE -ne 0) { throw 'Backend packaging failed' }
# Hyperscan's wheel uses an adjacent delvewheel directory. Other packages
# contain the same DLL but their search paths are not loaded when it imports.
$hyperscanLibs = Join-Path $projectRoot '.venv/Lib/site-packages/hyperscan.libs'
Copy-Item -LiteralPath $hyperscanLibs -Destination (Join-Path $projectRoot 'backend-dist/pdfsandwich-worker/_internal') -Recurse -Force
# tiktoken discovers encoding providers through a namespace package at runtime.
Copy-Item -LiteralPath (Join-Path $projectRoot '.venv/Lib/site-packages/tiktoken_ext') -Destination (Join-Path $projectRoot 'backend-dist/pdfsandwich-worker/_internal') -Recurse -Force
