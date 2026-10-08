"""Optional offline formula recognition using pinned RapidLaTeXOCR ONNX weights."""
import hashlib
from pathlib import Path
from PIL import Image, ImageStat

VERSION = 'rapid-latex-ocr-0.0.9'
BASE = 'https://github.com/RapidAI/RapidLaTeXOCR/releases/download/v0.0.0/'
MODELS = {
    'encoder.onnx': '01bf5dc25539ca0cd5b1bd29296ea495977a6ba5f629dc4178277809d26e5e7d',
    'decoder.onnx': 'bd695497bf1b22279b7626f5916c79226e1e244c84355f8da7edfd2d921d0072',
    'image_resizer.onnx': 'e0b075c39700f64d50400f39c8fc186bbb3b5d84d31864008313f376603aca9d',
    'tokenizer.json': '1dc27b18d6a518d0d5ff3f4bb7bd98521fe80ad39e5b2a246d4109f1bb9d5019',
}


def prepare(directory, progress=lambda _text: None):
    from hy_model import download
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, digest in MODELS.items():
        file = directory / name
        verified = file.with_suffix(file.suffix + '.verified')
        if file.exists() and not verified.exists():
            with file.open('rb') as stream:
                if hashlib.file_digest(stream, 'sha256').hexdigest() == digest:
                    verified.write_text(digest)
        download(BASE + name, file, digest, progress)
    return directory


def recognize(image, directory):
    import contextlib
    import io
    import numpy as np
    from formula_runtime import LaTeXOCR
    with Image.open(image) as source:
        if source.width * source.height > 16_000_000:
            raise ValueError('请只框选单个公式，范围不宜过大。')
        if max(ImageStat.Stat(source.convert('L')).stddev) < 2:
            raise ValueError('所选区域没有可识别的公式。')
    folder = prepare(directory)
    # All explicit paths prevent library code from writing to the installation.
    with contextlib.redirect_stdout(io.StringIO()):
        model = LaTeXOCR(image_resizer_path=folder/'image_resizer.onnx', encoder_path=folder/'encoder.onnx', decoder_path=folder/'decoder.onnx', tokenizer_json=folder/'tokenizer.json')
        np.random.seed(0)
        latex, seconds = model(image)
    return {'latex': latex.strip(), 'seconds': seconds, 'engine': VERSION}
