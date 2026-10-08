"""Optional offline formula recognition using pinned PP-FormulaNet_plus-L."""
import hashlib
import time
from pathlib import Path
from PIL import Image, ImageStat

VERSION = 'pp-formulanet-plus-l-v1'
BASE = 'https://www.modelscope.cn/models/RapidAI/RapidDoc/resolve/v1.0.0/formula/PP-FormulaNet_plus-L/'
MODELS = {
    'pp_formulanet_plus_l.onnx': '5ef81a0b197ea2c8c1463b31c3eb2ad0ae1eb655fb1ff3b550858c7d85bc84e8',
}


def prepare(directory, progress=lambda _text: None):
    from hy_model import download
    directory = Path(directory) / VERSION
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
    from formula_pp import FormulaModel
    with Image.open(image) as source:
        if source.width * source.height > 16_000_000:
            raise ValueError('请只框选单个公式，范围不宜过大。')
        if max(ImageStat.Stat(source.convert('L')).stddev) < 2:
            raise ValueError('所选区域没有可识别的公式。')
        source.load()
        crop = source.convert('RGB')
    folder = prepare(directory)
    started = time.perf_counter()
    model = FormulaModel(folder/'pp_formulanet_plus_l.onnx')
    latex = model.recognize(crop)
    return {'latex': latex, 'seconds': time.perf_counter()-started, 'engine': VERSION}
