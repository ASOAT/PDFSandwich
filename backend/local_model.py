"""CPU-local English -> Chinese translation using the official Argos language package.

Uses CTranslate2 and SentencePiece directly, avoiding online tokenizers or sentence splitters.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import threading
import urllib.request
import uuid
import zipfile
from translation_quality import translation_problem

MODEL_URL = "https://data.argosopentech.com/argospm/v1/translate-en_zh-1_9.argosmodel"
MODEL_VERSION = "argos-en-zh-1.9"
MODEL_SHA256 = "433e7c4f034d87fbe2353161e05f18646d7999452f801a4e1f0378522b9850ab"


def prepare_model(directory, progress=lambda message: None):
    directory = Path(directory)
    destination = directory / MODEL_VERSION
    manifest = destination / "installed.json"
    if manifest.exists():
        info = json.loads(manifest.read_text(encoding="utf-8"))
        if (destination / info["model"] / "model.bin").exists() and (destination / info["tokenizer"]).exists():
            return destination, info
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / (MODEL_VERSION + ".argosmodel")
    progress("正在下载离线英译中模型（仅首次需要）")
    from model_download import download
    download(MODEL_URL,archive,MODEL_SHA256,progress)
    staging = directory / f"{MODEL_VERSION}.{uuid.uuid4().hex}.staging"
    staging.mkdir()
    with zipfile.ZipFile(archive) as package:
        for member in package.infolist():
            target = (staging / member.filename).resolve()
            if not target.is_relative_to(staging.resolve()):
                raise ValueError("模型压缩包路径无效。")
        if sum(x.file_size for x in package.infolist()) > 2*1024**3:
            raise ValueError("模型压缩包大小异常。")
        package.extractall(staging)
    binary = next(staging.rglob("model.bin"))
    tokenizer = next(staging.rglob("sentencepiece.model"))
    info = {"model": str(binary.parent.relative_to(staging)), "tokenizer": str(tokenizer.relative_to(staging)),
            "sha256": MODEL_SHA256, "source": MODEL_URL, "version": MODEL_VERSION}
    (staging / "installed.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    if destination.exists():
        raise ValueError("离线模型安装目录不完整，请在设置中选择新的模型目录。")
    os.replace(staging, destination)
    archive.unlink(missing_ok=True)
    archive.with_suffix(archive.suffix+'.verified').unlink(missing_ok=True)
    return destination, info


class LocalModel:
    def __init__(self, directory, progress=lambda message: None):
        import ctranslate2
        import sentencepiece
        root, info = prepare_model(directory, progress)
        self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(root / info["tokenizer"]))
        self.engine = ctranslate2.Translator(str(root / info["model"]), device="cpu", compute_type="int8", inter_threads=1, intra_threads=4)
        self.lock = threading.Lock()
        self.records = []

    def decode(self, tokens):
        return self.tokenizer.decode(tokens).replace("▁", " ").strip()

    def translate(self, text):
        # Preserve formula placeholders literally; the layout engine replaces them afterwards.
        fragments = re.split(r"(\{\s*v\s*\d+\s*\})", text)
        translated = []
        for fragment in fragments:
            if not fragment.strip() or re.fullmatch(r"\{\s*v\s*\d+\s*\}", fragment):
                translated.append(fragment); continue
            # Sentence boundaries avoid silently truncating long paragraphs.
            sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z])", fragment.strip())
            for sentence in sentences:
                tokens = self.tokenizer.encode(sentence, out_type=str)
                for offset in range(0, len(tokens), 200):
                    part = tokens[offset:offset+200]
                    with self.lock:
                        result = self.engine.translate_batch([part], beam_size=4, length_penalty=0.2, replace_unknowns=True, max_decoding_length=512, return_attention=True)[0]
                    target = result.hypotheses[0]
                    output = self.decode(target)
                    # Fragmented captions can trigger subtitle-format hallucinations
                    # in the small model. Preserve the source fragment in that case.
                    problem = translation_problem(self.decode(part), output)
                    if problem:
                        raise ValueError(problem)
                    translated.append(output)
                    def spans(items):
                        ends = [len(self.decode(items[:i])) for i in range(len(items)+1)]
                        return [[ends[i],ends[i+1]] for i in range(len(items))]
                    attention = result.attention[0] if result.attention else []
                    links = [max(range(len(row)), key=row.__getitem__) if row else -1 for row in attention]
                    self.records.append({"source": self.decode(part), "target": output,
                                         "sourceSpans": spans(part), "targetSpans": spans(target), "links": links})
        return "".join(translated)

    def save_alignment(self, file):
        Path(file).write_text(json.dumps(self.records, ensure_ascii=False), encoding="utf-8")


def aligned_quote(records, selected, origin):
    selected = re.sub(r"\s+", " ", selected).strip()
    if not selected:
        return None
    for record in records:
        text = record["source" if origin == "en" else "target"]
        start = text.find(selected)
        if start < 0:
            continue
        end = start + len(selected)
        from_spans = record["sourceSpans" if origin == "en" else "targetSpans"]
        indexes = {i for i,(a,b) in enumerate(from_spans) if b>start and a<end}
        links = record["links"]
        target_indexes = {i for i,source in enumerate(links) if source in indexes} if origin == "en" else {links[i] for i in indexes if i<len(links) and links[i]>=0}
        to_spans = record["targetSpans" if origin == "en" else "sourceSpans"]
        target_indexes = {i for i in target_indexes if i<len(to_spans)}
        if not target_indexes:
            continue
        a = min(to_spans[i][0] for i in target_indexes); b = max(to_spans[i][1] for i in target_indexes)
        return record["target" if origin == "en" else "source"][a:b].strip()
    return None
