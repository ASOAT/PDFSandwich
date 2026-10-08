$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
& .venv\Scripts\python.exe scripts/patch-layout.py
if ($LASTEXITCODE -ne 0) { throw 'Pinned layout patch failed' }
& .venv\Scripts\python.exe -m PyInstaller --noconfirm --name pdfsandwich-worker --distpath backend-dist --workpath tmp/pyinstaller --specpath tmp --paths backend --collect-all babeldoc --collect-all pdf2zh_next --collect-all tokenizers --collect-all onnxruntime --collect-all tiktoken --collect-all ctranslate2 --collect-all sentencepiece --collect-all bitstring --collect-all bitarray --hidden-import formula_runtime --hidden-import research --hidden-import formula_ocr --hidden-import translate --hidden-import local_model --hidden-import hy_model --hidden-import text_engine --hidden-import translation_quality --hidden-import toc_layout --hidden-import alignment --hidden-import annotation_alignment --hidden-import layout_runtime --hidden-import pymupdf --hidden-import huggingface_hub --exclude-module pytest backend/worker.py
if ($LASTEXITCODE -ne 0) { throw 'Backend packaging failed' }
# Hyperscan's wheel uses an adjacent delvewheel directory. Other packages
# contain the same DLL but their search paths are not loaded when it imports.
$hyperscanLibs = Join-Path $projectRoot '.venv/Lib/site-packages/hyperscan.libs'
Copy-Item -LiteralPath $hyperscanLibs -Destination (Join-Path $projectRoot 'backend-dist/pdfsandwich-worker/_internal') -Recurse -Force
# tiktoken discovers encoding providers through a namespace package at runtime.
Copy-Item -LiteralPath (Join-Path $projectRoot '.venv/Lib/site-packages/tiktoken_ext') -Destination (Join-Path $projectRoot 'backend-dist/pdfsandwich-worker/_internal') -Recurse -Force
$formulaData = Join-Path $projectRoot 'backend-dist/pdfsandwich-worker/_internal/formula_runtime'
New-Item -ItemType Directory -Force -Path $formulaData | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'backend/formula_runtime/config.yaml') -Destination $formulaData -Force
