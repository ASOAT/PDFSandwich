"""Resolve bilingual ranges against PDF glyphs, including wrapped text."""
import re
import pymupdf as fitz
from alignment import compact, aligned_ranges


def indexed(text):
    value, positions = '', []
    for index, char in enumerate(text):
        normalized = compact(char)
        value += normalized; positions.extend([index]*len(normalized))
    return value, positions


def occurrences(haystack, needle):
    if not needle:
        return
    start = 0
    while (index := haystack.find(needle, start)) >= 0:
        yield index
        start = index+1


def glyphs(page):
    chars = []
    for block in page.get_text('rawdict')['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            chars.extend(char for span in line['spans'] for char in span['chars'])
    text, positions = indexed(''.join(char['c'] for char in chars))
    # rawdict character strings can contain a ligature, but each maps to one box.
    char_indexes = [i for i,char in enumerate(chars) for _ in char['c']]
    return text, [chars[char_indexes[i]] for i in positions]


def boxes(chars):
    lines = []
    for char in chars:
        if not char['c'].strip():
            continue
        box = fitz.Rect(char['bbox'])
        baseline = char['origin'][1]
        gap = max(3, box.height * .55)
        line = next((line for line in lines if abs(line[0]-baseline)<1 and
                     box.x0 <= line[1].x1+gap and box.x1 >= line[1].x0-gap), None)
        if line:
            line[1] |= box
        else:
            lines.append([baseline, box])
    return [[round(v,3) for v in line[1]] for line in lines]


def locate(page_text, page_chars, text, a=0, b=None):
    normalized, indices = indexed(text)
    b = len(text) if b is None else b
    selected = [i for i,p in enumerate(indices) if a<=p<b]
    if not selected:
        return []
    return [page_chars[start+selected[0]:start+selected[-1]+1]
            for start in occurrences(page_text, normalized)]


def coverage(chars, selection):
    return sum(max((fitz.Rect(char['bbox']) & rect).get_area() for rect in selection)
               for char in chars) / max(1, sum(fitz.Rect(char['bbox']).get_area() for char in chars))


def map_records(page, counterpart, item, records):
    origin = item.get('origin', 'en')
    src, dst = ('source','target') if origin=='en' else ('target','source')
    selection = [fitz.Rect(rect) for rect in item[origin]['rects']]
    selected = compact(item.get('selectedText') or ' '.join(page.get_textbox(rect) for rect in selection))
    if not selected:
        return None
    source_text, source_chars = glyphs(page)
    target_text, target_chars = glyphs(counterpart)
    candidates = []
    for record in records:
        normalized, indices = indexed(record[src])
        for offset in occurrences(normalized, selected):
            a, b = indices[offset], indices[offset+len(selected)-1]+1
            source_hits = locate(source_text, source_chars, record[src], a, b)
            # Formula placeholders are replaced by original vector glyphs during
            # typesetting; use their adjacent literal fragment for page lookup.
            if not source_hits:
                for fragment in re.finditer(r'[^{}]+(?=\{|$)', record[src]):
                    if fragment.start()<=a and b<=fragment.end():
                        source_hits = locate(source_text,source_chars,fragment.group(),a-fragment.start(),b-fragment.start())
                        if source_hits:break
            if not source_hits:
                continue
            overlap = max(coverage(hit,selection) for hit in source_hits)
            if overlap < .45:
                continue
            ranges = aligned_ranges(record,a,b,origin)
            mapped = []
            for start,end in ranges:
                hits = locate(target_text,target_chars,record[dst],start,end)
                if not hits:
                    for fragment in re.finditer(r'[^{}]+(?=\{|$)',record[dst]):
                        if fragment.start()<=start and end<=fragment.end():
                            hits=locate(target_text,target_chars,fragment.group(),start-fragment.start(),end-fragment.start())
                            if hits:break
                if hits:
                    def distance(chars):
                        box = fitz.Rect(boxes(chars)[0]); reference=selection[0]
                        return abs(box.y0-reference.y0)+abs(box.x0-reference.x0)*.2
                    mapped.extend(boxes(min(hits,key=distance)))
            if mapped:
                candidates.append((overlap,len(normalized),mapped))
    if not candidates:
        return None
    # Geometric source validation disambiguates repeated phrases on a page.
    best=max(candidates,key=lambda value:(value[0],-value[1]))
    return {'geometry':{'rects':best[2]},'accuracy':'phrase'}
