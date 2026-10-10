"""Small CPU adapter for PP-FormulaNet_plus ONNX; no Paddle / Torch dependency.

Preprocessing adapted from RapidAI/RapidDoc (Apache-2.0), commit
60cd038d424e0e839462ba4bd96345e0279290fe. See licenses/formula-pp-SOURCE.md.
"""
import json
import os
import re

import numpy as np
from PIL import Image, ImageOps


def normalize_prose(latex):
    """Repair letter-token spacing only in recognized mathematical prose.

    Math variables/matrices and unknown text are left untouched. Ordinary TeX
    spaces outside a text command disappear in math mode, so word boundaries
    next to variables belong inside the text command as well.
    """
    phrases = ('for all', 'and all', 'for any', 'for some', 'such that',
               'if and only if', 'subject to', 'otherwise', 'where', 'and',
               'for', 'with', 'when', 'if', 'or', 'as', 'almost everywhere')
    known = {phrase.replace(' ', ''): phrase for phrase in phrases}
    def repair(match):
        body = match[2]
        compact = re.sub(r'\s+', '', body)
        phrase = known.get(compact.lower())
        if not phrase:
            return match[0]
        if compact[:1].isupper():
            phrase = phrase[0].upper()+phrase[1:]
        command={'mathit':'textit','mathrm':'textrm'}.get(match[1],match[1])
        return '\\'+command+'{ '+phrase+' }'
    return re.sub(r'\\(text|textit|textrm|textnormal|textbf|mathit|mathrm)\s*\{([^{}]*)\}', repair, latex)


def preprocess(image, size=768):
    # Follow the model's UniMERNet preprocessing, including black letterboxing.
    # Preserve one full image: row splitting destroys matrices and large braces.
    import cv2
    rgb = np.array(image.convert('RGB'))
    bgr = rgb[:, :, ::-1]
    img = Image.fromarray(bgr)
    data = np.array(img.convert('L')).astype(np.float32)
    low, high = data.min(), data.max()
    if high == low:
        raise ValueError('所选区域没有可识别的公式。')
    ink = (data-low)/(high-low)*255 < 200
    ys, xs = np.nonzero(ink)
    img = img.crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1))
    w, h = img.size
    # Same two-stage resize as the published preprocessing.
    if w <= h:
        img = img.resize((size, int(size*h/w)), Image.Resampling.BILINEAR)
    else:
        img = img.resize((int(size*w/h), size), Image.Resampling.BILINEAR)
    img.thumbnail((size, size))
    dx, dy = size-img.width, size-img.height
    img = ImageOps.expand(img, (dx//2, dy//2, dx-dx//2, dy-dy//2))
    normalized = (np.array(img).astype(np.float32)/255 - np.float32(.7931))/np.float32(.1738)
    gray = cv2.cvtColor(normalized, cv2.COLOR_BGR2GRAY)
    return np.ascontiguousarray(gray[None, None], dtype=np.float32)


def decode(tokens, tokenizer):
    values = np.asarray(tokens).reshape(-1).tolist()
    ended = 2 in values
    if ended:
        values = values[:values.index(2)+1]
    latex = tokenizer.decode(values, skip_special_tokens=True).strip()
    # KaTeX accepts aligned inside display math, not top-level align/equation.
    # These substitutions affect wrappers only, never variables or matrix cells.
    latex = re.sub(r'\\(begin|end)\s*\{\s*align\*?\s*\}', r'\\\1{aligned}', latex)
    latex = re.sub(r'\\(?:begin|end)\s*\{\s*(?:equation\*?|displaymath)\s*\}', '', latex).strip()
    if not latex:
        raise ValueError('未识别到公式，请重新框选完整公式。')
    if not ended:
        raise ValueError('公式过长，识别结果未完整生成；请缩小到一个完整公式后重试。')
    return normalize_prose(latex)


class FormulaModel:
    def __init__(self, path):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        options = ort.SessionOptions()
        options.intra_op_num_threads = min(4, os.cpu_count() or 1)
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        self.session = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])
        character = json.loads(self.session.get_modelmeta().custom_metadata_map['character'])
        self.tokenizer = Tokenizer.from_str(json.dumps(character['fast_tokenizer_file']))

    def recognize(self, image):
        tensor = preprocess(image)
        tokens = self.session.run(None, {self.session.get_inputs()[0].name: tensor})[0]
        return decode(tokens, self.tokenizer)
