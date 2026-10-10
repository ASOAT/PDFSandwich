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


def record_instances(page_text, text):
    """Locate a record as an ordered chain, including its math gaps.

    A fragment such as "and" belongs to this record only when the surrounding
    literal runs also match in order. Keep the shortest chain ending at each
    occurrence; a repeated first word must not consume the previous paragraph.
    Dynamic programming bounds work even for many repeated short fragments.
    """
    parts = []
    for a,b in literal_spans(text):
        value, indices = indexed(text[a:b])
        if value:
            parts.append((a,b,value,indices))
    if not parts:
        return []
    if '{v' in text and max(len(p[2]) for p in parts) < 4:
        return []
    paths = []
    for number,(a,b,value,indices) in enumerate(parts):
        following = []
        for offset in occurrences(page_text,value):
            segment = (a,b,offset,offset+len(value),indices)
            if number == 0:
                following.append([segment])
                continue
            candidates = [path for path in paths if 0 <= offset-path[-1][3] <= 256]
            if candidates:
                best = max(candidates,key=lambda path:path[0][2])
                following.append(best+[segment])
        paths = following
        if not paths:
            break
    # A final punctuation run has many later occurrences. A chain starting at
    # the same anchor ends at its first valid completion, not at every period.
    shortest = {}
    for path in paths:
        start = path[0][2]
        if start not in shortest or path[-1][3] < shortest[start][-1][3]:
            shortest[start] = path
    return list(shortest.values())


def instance_box(instance, chars):
    return union_chars(chars[instance[0][2]:instance[-1][3]])


def union_chars(chars):
    result = fitz.Rect(chars[0]['bbox'])
    for char in chars[1:]:
        result |= fitz.Rect(char['bbox'])
    return result


def mapped_literal(instance, chars, start, end):
    result = []
    for a,b,left,right,indices in instance:
        result.extend(chars[left+i] for i,p in enumerate(indices) if start <= a+p < end)
    return result


def formula_gaps(instance, text):
    result = {}
    for left,right in zip(instance,instance[1:]):
        keys = tuple(re.findall(r'\{\s*v\s*(\d+)\s*\}', text[left[1]:right[0]]))
        if keys and right[2]>left[3]:
            result[keys] = (left[3],right[2])
    return result


def identity_hits(source_text, source_chars, target_text, target_chars, selection):
    """Map preserved math glyphs within an already identified formula region."""
    matcher = SequenceMatcher(None,source_text,target_text,autojunk=False)
    if matcher.ratio() < .75:
        return []
    return [target_chars[b+i] for a,b,size in matcher.get_matching_blocks() for i in range(size)
            if coverage([source_chars[a+i]],selection)>=.5]


def outside_instances(length, instances):
    intervals = sorted((item[0][2],item[-1][3]) for item in instances)
    result, cursor = [],0
    for a,b in intervals:
        if a>cursor:
            result.append((cursor,a))
        cursor=max(cursor,b)
    if cursor<length:
        result.append((cursor,length))
    return result


def owned_record_instances(source_text, target_text, records, src, dst):
    """A table cell's short text must not claim the same word inside prose.

    Resolve both sides first. A complete paragraph owns its contained literal
    matches, regardless of whether a table/header record with identical words
    would be geometrically closer to another occurrence after reflow.
    """
    resolved = []
    for record in records:
        sources = record_instances(source_text,record[src])
        targets = record_instances(target_text,record[dst])
        if sources and targets:
            resolved.append((record,sources,targets))
    bounds = [sorted({(p[0][2],p[-1][3]) for item in resolved for p in item[side]})
              for side in (1,2)]
    def owned(paths, intervals):
        return [p for p in paths if not any(
            a <= p[0][2] and p[-1][3] <= b and (a < p[0][2] or p[-1][3] < b)
            for a,b in intervals)]
    return [(record,owned(sources,bounds[0]),owned(targets,bounds[1]))
            for record,sources,targets in resolved]


def map_scoped_selection(source_text, source_chars, target_text, target_chars, selection, records, origin):
    src,dst = ('source','target') if origin=='en' else ('target','source')
    mapped, source_instances, target_instances = [],[],[]
    for record,sources,targets in owned_record_instances(source_text,target_text,records,src,dst):
        source_instances.extend(sources);target_instances.extend(targets)
        if not sources or not targets:
            continue
        for source in sources:
            reference = instance_box(source,source_chars)
            if not any(reference.intersects(rect) for rect in selection):
                continue
            # Matching the whole record establishes paragraph ownership first.
            # Geometry only disambiguates repeated copies of that same record.
            def distance(target):
                box = instance_box(target,target_chars)
                return abs(box.x0-reference.x0)+abs(box.y0-reference.y0)
            target = min(targets,key=distance)
            for a,b,left,right,indices in source:
                positions = [i for i,char in enumerate(source_chars[left:right]) if coverage([char],selection)>=.5]
                runs = []
                for i in positions:
                    if runs and i==runs[-1][-1]+1:
                        runs[-1].append(i)
                    else:
                        runs.append([i])
                for run in runs:
                    start,stop = a+indices[run[0]],a+indices[run[-1]]+1
                    for x,y in aligned_ranges(record,start,stop,origin):
                        mapped.extend(mapped_literal(target,target_chars,x,y))
            target_gaps = formula_gaps(target,record[dst])
            for key,(a,b) in formula_gaps(source,record[src]).items():
                if key in target_gaps:
                    c,d = target_gaps[key]
                    mapped.extend(identity_hits(source_text[a:b],source_chars[a:b],target_text[c:d],target_chars[c:d],selection))
    # Display equations and labels have no translation record. Search only the
    # remaining preserved content, never Chinese prose or another record's math.
    target_gaps = outside_instances(len(target_text),target_instances)
    for a,b in outside_instances(len(source_text),source_instances):
        chars = source_chars[a:b]
        if not any(coverage([char],selection)>=.5 for char in chars):
            continue
        reference = union_chars(chars)
        candidates = []
        for c,d in target_gaps:
            for offset in occurrences(target_text[c:d],source_text[a:b]):
                hit = target_chars[c+offset:c+offset+b-a]
                box = union_chars(hit)
                distance = abs(box.x0-reference.x0)+abs(box.y0-reference.y0)
                if distance <= max(80,reference.height*.75):
                    candidates.append((distance,hit))
        if candidates:
            hit = min(candidates,key=lambda pair:pair[0])[1]
            mapped.extend(hit[i] for i,char in enumerate(chars) if coverage([char],selection)>=.5)
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
    long_selection = len(selected)>=40 or (len(selection)>1 and len(selected)>=10) or not item.get('selectedText')
    # A stale/invalid short quote must not silently become a different selection.
    if not long_selection and selected not in source_text:
        return None
    mapped = map_scoped_selection(source_text,source_chars,target_text,target_chars,selection,records,origin)
    if mapped:
        return {'geometry':{'rects':mapped},'accuracy':'phrase'}
    if long_selection:
        return None
    candidates = []
    for record in records:
        normalized, indices = indexed(record[src])
        for offset in occurrences(normalized, selected):
            a, b = indices[offset], indices[offset+len(selected)-1]+1
            source_hits = contextual_hits(source_text, source_chars, record[src], a, b)
            if not source_hits:
                continue
            overlap, context = max((coverage(hit,selection),score) for hit,score in source_hits)
            if overlap < .45 or context < .6:
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


def pending_records(page, counterpart, item, records):
    """Select alignment work by actual selected glyphs, never by page-wide words."""
    origin=item.get('origin','en')
    src,dst=('source','target') if origin=='en' else ('target','source')
    selection=[fitz.Rect(rect) for rect in item[origin]['rects']]
    source_text,source_chars=glyphs(page)
    target_text,_=glyphs(counterpart)
    needed=[]
    for record,sources,targets in owned_record_instances(source_text,target_text,records,src,dst):
        if not record.get('alignmentPending') or not targets:
            continue
        if any(any(coverage([char],selection)>=.5 for char in source_chars[p[0][2]:p[-1][3]]) for p in sources):
            needed.append(record)
    return needed
