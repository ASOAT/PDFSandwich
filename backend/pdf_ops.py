"""PDF operations. Coordinates in the UI are unrotated PDF-page points, top-left origin."""
from __future__ import annotations
import hashlib
import json
import math
import os
import shutil
import time
import uuid
from pathlib import Path
import pymupdf as fitz

PREFIX = "PDFSandwich:"


def stamp(path):
    stat = Path(path).stat()
    # Nanosecond timestamps exceed JavaScript's safe integer range across IPC.
    return {"size": stat.st_size, "mtime": str(stat.st_mtime_ns)}


def rect_list(value):
    return [round(float(v), 3) for v in value]


def document_id(path):
    return hashlib.sha256(str(Path(path).resolve()).casefold().encode()).hexdigest()[:24]


def require_pdf(path):
    document = fitz.open(path)
    if not document.is_pdf:
        document.close()
        raise ValueError("请选择 PDF 文件。")
    if document.needs_pass:
        document.close()
        raise ValueError("此 PDF 需要密码。请先使用其他阅读器另存为无密码副本。")
    return document


def read_annotation(annot, page_number):
    info = annot.info
    subject = info.get("subject", "")
    if subject.startswith(PREFIX):
        try:
            item = json.loads(subject[len(PREFIX):])
            item["nativeXref"] = annot.xref
            item["page"] = page_number
            item["content"] = info.get("content", item.get("content", ""))
            return item
        except (ValueError, TypeError):
            pass
    kinds = {fitz.PDF_ANNOT_HIGHLIGHT: "highlight", fitz.PDF_ANNOT_UNDERLINE: "underline",
             fitz.PDF_ANNOT_INK: "ink", fitz.PDF_ANNOT_TEXT: "note"}
    kind = kinds.get(annot.type[0])
    if not kind:
        return None
    color = annot.colors.get("stroke") or (1, .75, .15)
    if len(color) != 3:
        color = (1, .75, .15)
    geometry = {"rects": [rect_list(annot.rect)]}
    vertices = annot.vertices
    if kind in ("highlight", "underline") and vertices:
        geometry["rects"] = [rect_list(fitz.Quad(vertices[i:i+4]).rect) for i in range(0, len(vertices), 4)]
    elif kind == "ink" and vertices:
        geometry["paths"] = [[[float(x), float(y)] for x, y in line] for line in vertices]
    return {"id": f"native-{page_number}-{annot.xref}", "page": page_number, "kind": kind,
            "color": "#" + "".join(f"{round(max(0,min(1,c))*255):02x}" for c in color),
            "width": annot.border.get("width", 1.5) or 1.5, "content": info.get("content", ""),
            "origin": "en", "en": geometry, "zh": None, "accuracy": "pending", "nativeXref": annot.xref}


def inspect(path):
    with require_pdf(path) as doc:
        pages, annotations, baseline = [], [], []
        for index in range(len(doc)):
            page = doc[index]
            pages.append({"width": page.cropbox.width, "height": page.cropbox.height, "rotation": page.rotation})
            for annot in page.annots() or []:
                item = read_annotation(annot, index)
                if item:
                    annotations.append(item)
                    baseline.append({"page": index, "xref": annot.xref})
        return {"id": document_id(path), "path": str(Path(path).resolve()), "name": Path(path).name,
                "pages": pages, "outline": doc.get_toc(), "annotations": annotations,
                "baseline": baseline, "stamp": stamp(path), "size": Path(path).stat().st_size}


def validate_annotation(item, page_count):
    if not isinstance(item.get("page"), int) or not 0 <= item["page"] < page_count:
        raise ValueError("标记页码无效。")
    if item.get("kind") not in ("highlight", "underline", "ink", "note"):
        raise ValueError("未知标记类型。")
    if len(item.get("content", "")) > 100_000:
        raise ValueError("批注过长。")
    for side in ("en", "zh"):
        geo = item.get(side)
        if not geo:
            continue
        for rect in geo.get("rects", []):
            if len(rect) != 4 or any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in rect):
                raise ValueError("标记位置无效。")
        for line in geo.get("paths", []):
            if len(line) > 50_000 or any(len(p) != 2 or any(not math.isfinite(x) for x in p) for p in line):
                raise ValueError("手绘路径无效。")


def add_annotation(page, item, side):
    geo = item.get(side)
    if not geo:
        return
    color = item.get("color", "#edb83b").lstrip("#")
    rgb = tuple(int(color[i:i+2], 16) / 255 for i in (0, 2, 4))
    from annotation_alignment import merge_rects
    rects = [fitz.Rect(r) for r in merge_rects(geo.get("rects", []))]
    kind = item["kind"]
    if kind in ("highlight", "underline"):
        if not rects:
            return
        quads = [rect.quad for rect in rects]
        annotation = page.add_highlight_annot(quads) if kind == "highlight" else page.add_underline_annot(quads)
    elif kind == "ink":
        paths = [line for line in geo.get("paths", []) if len(line) >= 2]
        if not paths:
            return
        annotation = page.add_ink_annot(paths)
        annotation.set_border(width=max(.5, min(8, item.get("width", 1.5))))
    else:
        if not rects:
            return
        annotation = page.add_text_annot(rects[0].tl, item.get("content", ""), icon="Comment")
    annotation.set_colors(stroke=rgb)
    saved = {k: v for k, v in item.items() if k != "nativeXref"}
    annotation.set_info(title="PDFSandwich", content=item.get("content", ""),
                        subject=PREFIX + json.dumps(saved, ensure_ascii=False, separators=(",", ":")))
    annotation.set_opacity(.35 if kind == "highlight" else 1)
    annotation.update()


def save_original(path, annotations, expected_stamp, baseline):
    """Stage a complete verified copy before replacing the original, never truncate the original."""
    if stamp(path) != expected_stamp:
        raise ValueError("原 PDF 已被其他程序修改。请重新打开文件后再保存，避免覆盖外部修改。")
    source = Path(path)
    temp = source.with_name(f".{source.name}.{uuid.uuid4().hex}.tmp")
    backup_dir = source.parent / ".pdfsandwich-backups"
    backup_dir.mkdir(exist_ok=True)
    backup = backup_dir / f"{source.stem}.{time.time_ns()}.pdf"
    shutil.copy2(source, backup)
    shutil.copy2(source, temp)
    try:
        with require_pdf(temp) as doc:
            if doc.get_sigflags() > 0:
                raise ValueError("此 PDF 含数字签名，不能直接覆盖。请先另存未签名副本。")
            if not (doc.permissions & fitz.PDF_PERM_ANNOTATE):
                raise ValueError("此 PDF 不允许修改批注。")
            by_page = {}
            for item in annotations:
                validate_annotation(item, len(doc))
                by_page.setdefault(item["page"], []).append(item)
            managed = {(a["page"], a["xref"]) for a in baseline}
            for number in sorted(set(by_page) | {p for p, _ in managed}):
                page = doc[number]
                for annot in list(page.annots() or []):
                    if (number, annot.xref) in managed or annot.info.get("subject", "").startswith(PREFIX):
                        page.delete_annot(annot)
                for item in by_page.get(number, []):
                    add_annotation(page, item, "en")
            if not doc.can_save_incrementally():
                raise ValueError("此 PDF 无法安全增量保存，请先在其他阅读器修复或另存副本。")
            doc.saveIncr()
        result = inspect(temp)
        if stamp(source) != expected_stamp:
            raise ValueError("保存期间原 PDF 被其他程序修改，已取消替换。")
        os.replace(temp, source)
        result.update(path=str(source), id=document_id(source), name=source.name, stamp=stamp(source), backup=str(backup))
        return result
    finally:
        temp.unlink(missing_ok=True)


def extract_page(path, index, output):
    with require_pdf(path) as doc, fitz.open() as part:
        part.insert_pdf(doc, from_page=index, to_page=index, annots=False)
        part.save(output, garbage=3, deflate=True)
    return {"path": output}


def texts(path, index):
    with require_pdf(path) as doc:
        page = doc[index]
        return [{"rect": rect_list(block[:4]), "text": block[4]} for block in page.get_text("blocks") if block[6] == 0]


def union(rects):
    return fitz.Rect(min(r[0] for r in rects), min(r[1] for r in rects), max(r[2] for r in rects), max(r[3] for r in rects))


def selection_geometry(path, page_indexes):
    from annotation_alignment import glyphs, boxes
    with require_pdf(path) as document:
        result = []
        for index in page_indexes:
            if not isinstance(index,int) or index<0 or index>=len(document):
                raise ValueError('选择的页码无效。')
            _,chars = glyphs(document[index])
            result.append({'page':index,'rects':boxes(chars)})
        return result


def map_annotation(source_path, target_path, item, quote=None):
    """Use text geometry near the translated paragraph. Return explicit approximate status."""
    origin, target = item.get("origin", "en"), "zh" if item.get("origin", "en") == "en" else "en"
    source_index, target_index = (item["page"], 0) if origin == "en" else (0, item["page"])
    geo = item.get(origin)
    if not geo:
        return {"geometry": None, "accuracy": "pending"}
    if item["kind"] in ("ink", "note"):
        return {"geometry": geo, "accuracy": "position"}
    with require_pdf(source_path) as src, require_pdf(target_path) as dst:
        page = src[source_index]
        counterpart = dst[target_index]
        alignment = Path(target_path if origin == "en" else source_path).with_name("alignment.json")
        if not quote and alignment.exists():
            from annotation_alignment import map_records
            mapped = map_records(page, counterpart, item, json.loads(alignment.read_text(encoding="utf-8")))
            if mapped:
                return mapped
        selected = union(geo["rects"])
        src_blocks = [b for b in page.get_text("blocks") if b[6] == 0]
        src_block = max(src_blocks, key=lambda b: (fitz.Rect(b[:4]) & selected).get_area(), default=None)
        region = fitz.Rect(src_block[:4]) if src_block else selected
        candidates = [b for b in counterpart.get_text("blocks") if b[6] == 0]
        def score(block):
            box = fitz.Rect(block[:4])
            overlap = (box & region).get_area() / max(1, min(box.get_area(), region.get_area()))
            distance = abs((box.x0+box.x1-region.x0-region.x1)/2) + abs((box.y0+box.y1-region.y0-region.y1)/2)
            return overlap * 1000 - distance
        block = max(candidates, key=score, default=None)
        if not block:
            return {"geometry": None, "accuracy": "unmatched", "targetText": ""}
        clip = fitz.Rect(block[:4]) + (-2, -2, 2, 2)
        if quote:
            hits = counterpart.search_for(quote, clip=clip, quads=True)
            if hits:
                return {"geometry": {"rects": [rect_list(q.rect) for q in hits]}, "accuracy": "phrase"}
        return {"geometry": None, "accuracy": "unmatched",
                "sourceText": src_block[4] if src_block else page.get_textbox(selected),
                "targetText": block[4], "selectedText": item.get("selectedText") or " ".join(page.get_textbox(fitz.Rect(r)) for r in geo["rects"])}


def export_pdf(source_path, translated_pages, annotations, output, mode):
    with require_pdf(source_path) as source, fitz.open() as result:
        for i in range(len(source)):
            if mode == "bilingual":
                result.insert_pdf(source, from_page=i, to_page=i, annots=True)
            translated = translated_pages.get(str(i))
            if not translated:
                raise ValueError(f"第 {i+1} 页尚未翻译，无法导出完整译文。")
            with require_pdf(translated) as part:
                result.insert_pdf(part, annots=False)
            page = result[-1]
            for item in annotations:
                if item["page"] == i:
                    add_annotation(page, item, "zh")
        result.save(output, garbage=3, deflate=True)
    return {"path": output}


def search(path, query, start=0, limit=100):
    matches = []
    with require_pdf(path) as doc:
        stop = min(start + 50, len(doc))
        for i in range(start, stop):
            page = doc[i]
            hits = page.search_for(query)
            if hits:
                matches.append({"page": i, "rects": [rect_list(r) for r in hits[:limit]], "text": page.get_textbox(hits[0] + (-15,-10,100,18)).replace("\n", " ")})
        return {"matches": matches, "next": stop if stop < len(doc) else None}
