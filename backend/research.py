"""On-demand research views; all coordinates use unrotated PDF points."""
import base64
import json
import re
from pathlib import Path
import pymupdf as fitz


def research_cover(path, output):
    with fitz.open(path) as document:
        page = document[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(360 / page.rect.width, 360 / page.rect.width), alpha=False, annots=False)
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        pix.save(output)
    return output


def research_identifiers(path):
    with fitz.open(path) as document:
        text = '\n'.join(document[i].get_text() for i in range(min(2, len(document))))
        doi = re.search(r'\b10\.\d{4,9}/[-._;()/:A-Z0-9]+', text, re.I)
        arxiv = re.search(r'(?:arxiv\s*:\s*|arxiv.org/(?:abs|pdf)/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+/\d{7}(?:v\d+)?)', text, re.I)
        title = document.metadata.get('title', '')
        if not title or len(title) < 8:
            blocks = document[0].get_text('blocks', sort=True)
            title = next((b[4].replace('\n',' ').strip() for b in blocks if b[6] == 0 and len(b[4].strip()) > 25), '')[:350]
    return {'doi': doi.group(0).rstrip('.,;') if doi else '', 'arxiv': arxiv.group(1) if arxiv else '', 'title': title}


def research_clip(path, page, rect=None, rects=None, image=False):
    with fitz.open(path) as document:
        p = document[page]
        region = fitz.Rect(rect) if rect else p.rect * p.derotation_matrix
        bounds = p.rect * p.derotation_matrix
        if region.is_empty or not all(__import__('math').isfinite(v) for v in region) or not bounds.contains(region):
            raise ValueError('截图范围超出页面。')
        selected = [fitz.Rect(r) for r in rects] if rects else [region]
        lines = []
        for block in p.get_text('rawdict')['blocks']:
            for line in block.get('lines', []):
                chars = []
                for span in line.get('spans', []):
                    for char in span['chars']:
                        box = fitz.Rect(char['bbox'])
                        if any((box & r).get_area() >= box.get_area() * .5 for r in selected):
                            chars.append(char['c'])
                if chars: lines.append(''.join(chars))
        result = {'text': '\n'.join(lines), 'rect': list(region)}
        if image:
            # get_pixmap's clip is in rotated coordinates; selection geometry is not.
            pix = p.get_pixmap(matrix=fitz.Matrix(2.5,2.5), clip=region * p.rotation_matrix, alpha=False, annots=False)
            result['png'] = base64.b64encode(pix.tobytes('png')).decode('ascii')
        return result


def research_paragraphs(path, page, translated=None):
    from annotation_alignment import glyphs, owned_record_instances, boxes
    with fitz.open(path) as document:
        source = document[page]
        if not translated or not Path(translated).is_file():
            return [{'id': str(i), 'source': b[4].strip(), 'target': '', 'rects': [list(b[:4])]} for i,b in enumerate(source.get_text('blocks',sort=True)) if b[6]==0 and b[4].strip()]
        alignment = Path(translated).parent / 'alignment.json'
        records = json.loads(alignment.read_text(encoding='utf-8')) if alignment.exists() else []
        with fitz.open(translated) as target_doc:
            st, sc = glyphs(source); tt, tc = glyphs(target_doc[0]); rows = []
            for i, (record, origins, targets) in enumerate(owned_record_instances(st,tt,records,'source','target')):
                if not origins or not targets: continue
                # Keep formula tokens explicit in reflow mode; the original PDF remains authoritative.
                clean = lambda value: re.sub(r'\{(?:v|f|m)\d+\}', '〔公式〕', value)
                rects = boxes(sc[origins[0][0][2]:origins[0][-1][3]])
                target_rects = boxes(tc[targets[0][0][2]:targets[0][-1][3]])
                rows.append({'id': str(i), 'source': clean(record['source']), 'target': clean(record['target']), 'rects': rects, 'targetRects': target_rects})
            rows.sort(key=lambda row: (round(row['rects'][0][0]/100), row['rects'][0][1]) if row['rects'] else (0,0))
            return rows
