# PP-FormulaNet_plus local adapter

- Model: PaddlePaddle/PaddleOCR PP-FormulaNet_plus-L, Apache-2.0. Official model card: https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-L .
- ONNX conversion: RapidAI/RapidDoc, pinned ModelScope release `v1.0.0`; SHA-256 and exact URL in `backend/formula_ocr.py`. Downloaded on demand; not bundled in installers or source archives.
- Preprocessing and decoding adapted from RapidAI/RapidDoc commit `60cd038d424e0e839462ba4bd96345e0279290fe`, `rapid_doc/model/formula/rapid_formula_self/model_handler/pp_formulanet_plus/`. Source: https://github.com/RapidAI/RapidDoc/tree/60cd038d424e0e839462ba4bd96345e0279290fe/rapid_doc/model/formula/rapid_formula_self/model_handler/pp_formulanet_plus . Apache-2.0 license included as `formula-pp-LICENSE.txt`.
- Changes: single-image CPU adapter using existing NumPy, Pillow, OpenCV, ONNX Runtime and Tokenizers; bounded CPU threads; no Paddle, Torch, Transformers or full RapidDoc pipeline. Preserve matrix rows and columns. Convert only display-environment wrappers for KaTeX; do not guess or rewrite mathematical variables.
- Model weights are unmodified. Upstream notices are retained alongside the project's AGPL-3.0-only source.
