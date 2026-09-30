"""Resolve bilingual ranges against PDF glyphs, including wrapped text."""
import re
from difflib import SequenceMatcher
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
    for block in page.get_text('rawdict', flags=fitz.TEXTFLAGS_RAWDICT & ~fitz.TEXT_PRESERVE_IMAGES)['blocks']:
        if block['type'] != 0:
            continue
        for line in block['lines']:
            chars.extend(char for span in line['spans'] for char in span['chars'])
    text, positions = indexed(''.join(char['c'] for char in chars))
    # rawdict character strings can contain a ligature, but each maps to one box.
    char_indexes = [i for i,char in enumerate(chars) for _ in char['c']]
    return text, [chars[char_indexes[i]] for i in positions]


def boxes(chars):
    # Normalization (e.g. ligatures) and overlapping aligned ranges can refer to
    # the same PDF glyph more than once. Draw each physical glyph only once.
    unique = {(tuple(char['bbox']), tuple(char['origin']), char['c']): char for char in chars}
    chars = sorted(unique.values(), key=lambda char: (round(char['origin'][1], 1), char['bbox'][0]))
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
    return merge_rects([[round(v,3) for v in line[1]] for line in lines])


def merge_rects(rects):
    """Coalesce overlapping runs on one line without bridging unselected words."""
    result = []
    for values in sorted(rects, key=lambda r: (r[1], r[0])):
        box = fitz.Rect(values)
        if box.is_empty:
            continue
        changed = True
        while changed:
            changed = False
            for i, other in enumerate(result):
                overlap = min(box.y1,other.y1)-max(box.y0,other.y0)
                same_line = overlap >= min(box.height,other.height)*.7 and abs((box.y0+box.y1-other.y0-other.y1)/2) <= min(box.height,other.height)*.35
                if same_line and box.x0 <= other.x1+.5 and other.x0 <= box.x1+.5:
                    box |= result.pop(i); changed = True; break
        result.append(box)
    return [[round(v,3) for v in rect] for rect in sorted(result,key=lambda r:(r.y0,r.x0))]


def literal_spans(text):
    cursor = 0
    for match in re.finditer(r'\{[^{}]*\}', text):
        if cursor < match.start():
            yield cursor, match.start()
        cursor = match.end()
    if cursor < len(text):
        yield cursor, len(text)


def target_hits(page_text, page_chars, text, start, end, reference):
    selected = []
    # A selected paragraph can contain formulas not present as literal text in
    # the translation record. Resolve its text runs independently around them.
    for a,b in literal_spans(text):
        a,b = max(a,start), min(b,end)
        if a >= b:
            continue
        hits = contextual_hits(page_text,page_chars,text,a,b)
        if hits:
            def score(hit):
                chars, context = hit
                box = fitz.Rect(chars[0]['bbox'])
                return (-context, abs(box.y0-reference.y0)+abs(box.x0-reference.x0)*.2)
            selected.extend(min(hits,key=score)[0])
    return selected


def map_long_selection(source_text, source_chars, target_text, target_chars, selection, records, origin):
    """Intersect a selection with every translation record, not just one quote."""
    from alignment import sentence_spans
    src,dst = ('source','target') if origin=='en' else ('target','source')
    mapped = []
    for record in records:
        for begin,end in literal_spans(record[src]):
            parts = [(begin,end)]
            # Usually the complete run is present. Sentence-sized recovery also
            # tolerates PDF extraction moving styled fragments between runs.
            if not locate(source_text,source_chars,record[src][begin:end]):
                parts = [(begin+a,begin+b) for a,b in sentence_spans(record[src][begin:end],origin=='en')]
            for a,b in parts:
                normalized,indices = indexed(record[src][a:b])
                for offset in occurrences(source_text,normalized):
                    chars = source_chars[offset:offset+len(normalized)]
                    positions = [i for i,char in enumerate(chars) if coverage([char],selection)>=.5]
                    if not positions:
                        continue
                    runs = []
                    for i in positions:
                        if runs and i == runs[-1][-1]+1:
                            runs[-1].append(i)
                        else:
                            runs.append([i])
                    for run in runs:
                        start,stop = a+indices[run[0]],a+indices[run[-1]]+1
                        reference = fitz.Rect(chars[run[0]]['bbox'])
                        for left,right in aligned_ranges(record,start,stop,origin):
                            mapped.extend(target_hits(target_text,target_chars,record[dst],left,right,reference))
    return boxes(mapped)


def locate(page_text, page_chars, text, a=0, b=None):
    normalized, indices = indexed(text)
    b = len(text) if b is None else b
    selected = [i for i,p in enumerate(indices) if a<=p<b]
    if not selected:
        return []
    return [page_chars[start+selected[0]:start+selected[-1]+1]
            for start in occurrences(page_text, normalized)]


def coverage(chars, selection):
    covered,total = 0,0
    for char in chars:
        x0,y0,x1,y1 = char['bbox']
        area = max(0,x1-x0)*max(0,y1-y0);total += area
        best = 0
        for rect in selection:
            if rect.y1<=y0 or rect.y0>=y1:
                continue
            best = max(best,max(0,min(x1,rect.x1)-max(x0,rect.x0))*max(0,min(y1,rect.y1)-max(y0,rect.y0)))
            if best>=area:
                break
        covered += best
    return covered/max(1,total)


def contextual_hits(page_text, page_chars, text, a, b):
    """Find a short range even when PDF extraction reorders styled/math runs.

    Score nearby literal text to distinguish repeated phrases. Requiring an
    entire translated paragraph to be contiguous made valid marks disappear.
    """
    exact = locate(page_text, page_chars, text, a, b)
    if exact:
        return [(chars, 1.0) for chars in exact]
    left = max((m.end() for m in re.finditer(r'\{[^{}]*\}', text[:a])), default=0)
    following = re.search(r'\{[^{}]*\}', text[b:])
    right = b+following.start() if following else len(text)
    fragment = text[left:right]
    exact = locate(page_text, page_chars, fragment, a-left, b-left)
    if exact:
        return [(chars, 1.0) for chars in exact]
    phrase = compact(text[a:b])
    before, after = compact(text[left:a])[-60:], compact(text[b:right])[:60]
    result = []
    for offset in occurrences(page_text, phrase):
        length = len(phrase)
        checks = []
        if before:
            checks.append(SequenceMatcher(None,before,page_text[max(0,offset-len(before)):offset],autojunk=False).ratio())
        if after:
            checks.append(SequenceMatcher(None,after,page_text[offset+length:offset+length+len(after)],autojunk=False).ratio())
        score = sum(checks)/len(checks) if checks else 1.0
        result.append((page_chars[offset:offset+length],score))
    return result


def map_records(page, counterpart, item, records):
    origin = item.get('origin', 'en')
    src, dst = ('source','target') if origin=='en' else ('target','source')
    selection = [fitz.Rect(rect) for rect in item[origin]['rects']]
    source_text, source_chars = glyphs(page)
    # get_textbox includes adjacent-line glyphs that only touch the selection.
    # Rebuilding an English anchor after re-layout must use the selected glyphs.
    selected = compact(item.get('selectedText') or ''.join(
        source_text[i] for i,char in enumerate(source_chars)
        if coverage([char], selection) >= .5))
    if not selected:
        return None
    target_text, target_chars = glyphs(counterpart)
    if len(selected) >= 40 or (len(selection)>1 and len(selected)>=10) or not item.get('selectedText'):
        mapped = map_long_selection(source_text,source_chars,target_text,target_chars,selection,records,origin)
        if mapped:
            return {'geometry':{'rects':mapped},'accuracy':'phrase'}
    candidates = []
    for record in records:
        normalized, indices = indexed(record[src])
        for offset in occurrences(normalized, selected):
            a, b = indices[offset], indices[offset+len(selected)-1]+1
            source_hits = contextual_hits(source_text, source_chars, record[src], a, b)
            if not source_hits:
                continue
            overlap, context = max((coverage(hit,selection),score) for hit,score in source_hits)
            if overlap < .45:
                continue
            ranges = aligned_ranges(record,a,b,origin)
            mapped = []
            for start,end in ranges:
                hits = contextual_hits(target_text,target_chars,record[dst],start,end)
                if hits:
                    def distance(hit):
                        chars, score = hit
                        box = fitz.Rect(boxes(chars)[0]); reference=selection[0]
                        return (-score, abs(box.y0-reference.y0)+abs(box.x0-reference.x0)*.2)
                    mapped.extend(boxes(min(hits,key=distance)[0]))
            if mapped:
                candidates.append((overlap,context,len(normalized),mapped))
    if not candidates:
        return None
    # Geometric source validation disambiguates repeated phrases on a page.
    best=max(candidates,key=lambda value:(value[0],value[1],-value[2]))
    return {'geometry':{'rects':merge_rects(best[3])},'accuracy':'phrase'}
