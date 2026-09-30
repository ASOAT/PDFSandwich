"""Align existing translations without generating or changing their wording."""
import json
import math
import re
import unicodedata
from pathlib import Path
from translation_quality import matching_terms

_aligners = {}


def anchored_pairs(source, target):
    """Use preserved math identities to stop sentence alignment from drifting."""
    pattern = r'\{\s*v\s*(\d+)\s*\}'
    left, right = list(re.finditer(pattern, source)), list(re.finditer(pattern, target))
    if not left or [m[1] for m in left] != [m[1] for m in right]:
        return sentence_pairs(source, target)
    pairs = []
    a = b = 0
    for x, y in zip(left, right):
        if source[a:x.start()].strip() and target[b:y.start()].strip():
            pairs.extend(((i+a,j+a),(k+b,l+b)) for (i,j),(k,l) in sentence_pairs(source[a:x.start()],target[b:y.start()]))
        a, b = x.end(), y.end()
    if source[a:].strip() and target[b:].strip():
        pairs.extend(((i+a,j+a),(k+b,l+b)) for (i,j),(k,l) in sentence_pairs(source[a:],target[b:]))
    return pairs


def sentence_spans(text, english):
    boundaries = [0]
    pattern = r'(?<=[.!?])\s+(?=[A-Z])' if english else r'(?<=[。！？])\s*'
    for match in re.finditer(pattern, text):
        if english and re.search(r'(?:\b[A-Za-z]\.|\b(?:Mr|Dr|Prof|Fig|Eq|Sec|No)\.)$',text[:match.start()]):
            continue
        if match.end()>boundaries[-1]:boundaries.append(match.end())
    if boundaries[-1]!=len(text):boundaries.append(len(text))
    return [(a,b) for a,b in zip(boundaries,boundaries[1:]) if text[a:b].strip()]


def sentence_pairs(source, target):
    a,b=sentence_spans(source,True),sentence_spans(target,False)
    if not a or not b:return []
    if len(a)==len(b):return list(zip(a,b))
    # Monotone alignment permits a translator to split or merge a sentence.
    # Keep abbreviation initials together; avoid feeding a whole long paragraph
    # through a model trained predominantly on sentence-sized examples.
    ratio=len(target)/max(1,len(source));best={(0,0):(0,[])}
    for i in range(len(a)+1):
        for j in range(len(b)+1):
            if (i,j) not in best:continue
            cost,path=best[i,j]
            for n,m in ((1,1),(1,2),(2,1)):
                if i+n>len(a) or j+m>len(b):continue
                left=(a[i][0],a[i+n-1][1]);right=(b[j][0],b[j+m-1][1])
                distance=abs(math.log((right[1]-right[0]+5)/((left[1]-left[0])*ratio+5)))+.4*(n+m-2)
                key=(i+n,j+m);candidate=(cost+distance,path+[(left,right)])
                if key not in best or candidate[0]<best[key][0]:best[key]=candidate
    return best.get((len(a),len(b)),(0,[((0,len(source)),(0,len(target)))]))[1]


def compact(text):
    # PDF extraction can insert spaces, soft hyphens, and line-wrap hyphens.
    return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold()
                   if not c.isspace() and c not in '-\u00ad')


def utf8_boundaries(text):
    """SentencePiece protobuf spans are UTF-8 bytes, PDF spans are characters."""
    result={0:0};offset=0
    for index,char in enumerate(text):
        offset+=len(char.encode('utf-8'));result[offset]=index+1
    return result


class PhraseAligner:
    def __init__(self, directory, progress):
        from local_model import LocalModel, prepare_model
        root, info = prepare_model(directory, progress)
        self.model = LocalModel(directory, progress)
        self.vocabulary = set(json.loads((root / info['model'] / 'shared_vocabulary.json').read_text(encoding='utf-8')))

    def align(self, source, target):
        pairs=anchored_pairs(source,target)
        result={'sourceSpans':[],'targetSpans':[],'links':[]}
        for (a,b),(c,d) in pairs:
            part=self.align_sentence(source[a:b],target[c:d])
            if not part:continue
            offset=len(result['sourceSpans'])
            result['sourceSpans'].extend([[x+a,y+a] for x,y in part['sourceSpans']])
            result['targetSpans'].extend([[x+c,y+c] for x,y in part['targetSpans']])
            result['links'].extend([x+offset if x>=0 else -1 for x in part['links']])
        return result

    def align_sentence(self, source, target):
        pieces = self.model.tokenizer.encode(source, out_type='proto').pieces
        inputs = [p.piece for p in pieces]
        if not inputs or len(inputs) > 400 or len(target) > 650:
            return {}
        # This Argos package's SentencePiece model covers English only. Chinese
        # decoder tokens must come from its actual target/shared vocabulary.
        tokens, spans = ['▁'], [[0, 0]]
        index = 0
        while index < len(target):
            if target[index].isspace():
                tokens.append('▁'); spans.append([index, index + 1]); index += 1
                continue
            token = next((target[index:index+n] for n in range(min(3, len(target)-index), 0, -1)
                          if target[index:index+n] in self.vocabulary), None)
            if token is None:
                # Unknown formula symbols must not corrupt the remaining offsets.
                token = '<unk>'; length = 1
            else:
                length = len(token)
            tokens.append(token); spans.append([index, index + length]); index += length
        result = self.model.engine.translate_batch([inputs], target_prefix=[tokens],
                    beam_size=1, max_decoding_length=len(tokens)+1,
                    max_input_length=512, return_attention=True)[0]
        if result.hypotheses[0][:len(tokens)] != tokens or not result.attention:
            return {}
        rows = result.attention[0][:len(tokens)]
        links = [max(range(len(row)), key=row.__getitem__) if tokens[i]!='<unk>' and max(row, default=0) >= .15 else -1 for i,row in enumerate(rows)]
        # Expand English subwords to words for reverse selections, e.g. robotic+s.
        words = [m.span() for m in re.finditer(r"\w+(?:['’-]\w+)*|[^\w\s]", source)]
        boundaries=utf8_boundaries(source)
        source_spans = []
        for piece in pieces:
            begin,end=boundaries[piece.begin],boundaries[piece.end]
            overlapping = [(a,b) for a,b in words if b > begin and a < end]
            source_spans.append([min(a for a,b in overlapping), max(b for a,b in overlapping)]
                                if overlapping else [begin, end])
        return {'sourceSpans': source_spans, 'targetSpans': spans, 'links': links}


def make_record(source, target, directory, progress, custom='', use_builtin=True):
    record = {'source': source, 'target': target, 'terms': matching_terms(source, custom, use_builtin)}
    key = str(Path(directory).resolve())
    try:
        if key not in _aligners:
            progress('正在准备离线词句对应模型（仅首次需要）…')
            _aligners[key] = PhraseAligner(directory, progress)
        record.update(_aligners[key].align(source, target))
    except (OSError, RuntimeError, ValueError):
        # Alignment failure must neither replace good translation nor fabricate
        # a paragraph-wide underline. Exact terms / full segments still work.
        pass
    return record


def aligned_ranges(record, start, end, origin):
    """Return possibly disjoint target ranges; do not underline intervening words."""
    src, dst = ('source','target') if origin == 'en' else ('target','source')
    text, target = record[src], record[dst]
    selection = compact(text[start:end])
    if not selection:
        return []
    if selection == compact(text):
        return [(0, len(target))]
    # Names, acronyms and other identity text are often intentionally retained.
    # Match their unique literal occurrence before consulting attention weights.
    if len(selection) >= 3:
        matches = list(re.finditer(re.escape(text[start:end]), target, re.I))
        if len(matches) == 1:
            return [matches[0].span()]
    for english, chinese in sorted(record.get('terms', []), key=lambda pair: -len(pair[0])):
        a, b = (english, chinese) if origin == 'en' else (chinese, english)
        if compact(a) == selection:
            matches = list(re.finditer(re.escape(b), target, re.I))
            if len(matches) == 1:
                return [matches[0].span()]
    from_spans = record.get(src+'Spans', [])
    to_spans = record.get(dst+'Spans', [])
    indexes = {i for i,(a,b) in enumerate(from_spans) if b>start and a<end}
    links = record.get('links', [])
    selected = ({i for i,s in enumerate(links) if s in indexes} if origin == 'en'
                else {links[i] for i in indexes if i<len(links) and links[i]>=0})
    ranges = sorted({tuple(to_spans[i]) for i in selected if i<len(to_spans) and to_spans[i][1]>to_spans[i][0]})
    merged = []
    for a,b in ranges:
        if not target[a:b].strip() or not re.search(r'\w', target[a:b]):
            continue
        if merged and (a <= merged[-1][1] or not target[merged[-1][1]:a].strip()):
            merged[-1] = (merged[-1][0], max(b,merged[-1][1]))
        else:
            merged.append((a,b))
    # Reject obviously diffuse attention for a small selection.
    if merged and (sum(b-a for a,b in merged)/max(1,len(target)) >
                   max(.35, (end-start)/max(1,len(text))*3)):
        return []
    return merged
