# Local formula runtime

Source: **RapidAI/RapidLaTeXOCR**, PyPI `rapid-latex-ocr` **0.0.9**, MIT license (included in `LICENSE`).

- Upstream: https://github.com/RapidAI/RapidLaTeXOCR
- Wheel: https://files.pythonhosted.org/packages/05/a7/4582bc91c6afb95349cca6760309870eb9a0c56a127c76cd78efc0ee32f0/rapid_latex_ocr-0.0.9-py3-none-any.whl
- Local modification: in `main.py`, explicitly convert the single-element argmax array with `.item()` for NumPy 2 compatibility. The existing translation stack uses NumPy 2; no global NumPy monkeypatch is applied.
- The wrapper `backend/formula_ocr.py` supplies every model path explicitly, checks the crop and uses pinned SHA-256 model downloads in the user's model cache. Weights are not bundled into the installer.
- Runtime dependencies: the existing ONNX Runtime, OpenCV, NumPy, Pillow, PyYAML, requests and tqdm, plus tokenizers and chardet.

The original copyright and license text are retained. Upstream functions unrelated to recognition remain unchanged for reviewability.
