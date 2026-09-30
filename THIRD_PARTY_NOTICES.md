# Third-party components

PDFSandwich project source is licensed under GNU AGPL version 3 (AGPL-3.0-only).
See `LICENSE`. Third-party components retain their respective licenses.

| Component | Version | Upstream / license |
| --- | --- | --- |
| Mozilla PDF.js | 6.3.289 | https://github.com/mozilla/pdf.js — Apache-2.0 |
| Electron | 44.4.5 | https://github.com/electron/electron — MIT; includes Chromium notices |
| electron-updater | 6.8.9 | https://github.com/electron-userland/electron-builder — MIT |
| React | 19.x | https://github.com/facebook/react — MIT |
| Lucide | 0.577.x | https://github.com/lucide-icons/lucide — ISC |
| PyMuPDF | 1.25.2 | https://github.com/pymupdf/PyMuPDF — AGPL-3.0/commercial dual licensing |
| PDFMathTranslate-next | 2.9.0 | https://github.com/PDFMathTranslate-next/PDFMathTranslate-next — AGPL-3.0 |
| BabelDOC | 0.6.2 | https://github.com/funstory-ai/BabelDOC — AGPL-3.0 |
| CTranslate2 | 4.8.2 | https://github.com/OpenNMT/CTranslate2 — MIT |
| SentencePiece | 0.2.2 | https://github.com/google/sentencepiece — Apache-2.0 |
| ONNX Runtime | pinned in backend lock | https://github.com/microsoft/onnxruntime — MIT |
| HY-MT translation weights | 1.5, 1.8B Q4_K_M | https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF — Tencent HY Community License (open weights with use/territory restrictions, not an OSI license) |
| llama.cpp Vulkan runtime | b11243 Windows x64 | https://github.com/ggml-org/llama.cpp — MIT |

The HY model and runtime are fetched from pinned official URLs and checked with
SHA-256 before use. Model SHA-256:
`4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7`.
The original model agreement and notice are in `licenses/` and included in
`resources/licenses/models/`. The model has not been fine-tuned or modified by
this project. It is downloaded separately, not included in the installer.

The offline en→zh language package is downloaded on first use from the official
Argos distribution: https://data.argosopentech.com/argospm/v1/translate-en_zh-1_9.argosmodel
(SHA-256 `433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab`).
Argos code is MIT/CC0; this statement is not a blanket license claim about model
training data. Model package metadata and included notices stay with the download.

BabelDOC downloads its layout model and fonts into the user's local cache. Those
assets have their own upstream terms. They are not committed to this repository.

The local build applies two import substitutions to BabelDOC 0.6.2, recorded in
`scripts/patch-layout.py`: glyph radius clustering (DBSCAN, min_samples=1) and
default grayscale SSIM use `backend/pdfsandwich_layout_math.py`. This removes
unused scientific-library initialization; layout and scan-detection behavior are
checked against the upstream numerical implementations. The pinned dependency
retains its AGPL license and its source files are included by the backend build.

The build collects available dependency license/notice files and an installed
dependency inventory under `resources/licenses`. Electron's own LICENSE and
Chromium notice files also remain in the distribution. The inventory includes
some build-only dependencies; it is not a claim that every entry runs at runtime.

The public release includes the matching project/build source and exact source
distributions for PyMuPDF (including MuPDF native sources), BabelDOC and
PDFMathTranslate-next. Download the `PDFSandwich-<version>-source.zip` asset from
https://github.com/ASOAT/PDFSandwich/releases. Dependency source URLs and SHA-256
hashes are recorded inside the archive. See `scripts/source-bundle.py`.

Runtime adapters in `backend/layout_preservation.py`, `reference_layout.py` and
`layout_runtime.py` preserve mathematical glyph groups, bibliography entries,
heading numbers and translated text styles. They apply to the pinned BabelDOC
version; the original dependency source and these adapters are included together.
