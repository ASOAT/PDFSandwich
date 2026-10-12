"""On-demand research views; all coordinates use unrotated PDF points."""
import base64
import html
import re
import unicodedata
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
import pymupdf as fitz


def research_cover(path, output):
    with fitz.open(path) as document:
        page = document[0]
        pix = page.get_pixmap(matrix=fitz.Matrix(360 / page.rect.width, 360 / page.rect.width), alpha=False, annots=False)
        Path(output).parent.mkdir(parents=True, exist_ok=True)
        pix.save(output)
    return output


def _clean_text(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', html.unescape(text or '')).replace('\u00ad', '')).strip()


def _title_key(text):
    return ''.join(c for c in _clean_text(text).casefold() if c.isalnum())


def _plausible_title(text):
    if not 4 <= len(text) <= 350 or len(re.findall(r'[A-Za-z\u3400-\u9fff]', text)) < 4:
        return False
    if re.fullmatch(r'(?:untitled|title|document|paper|manuscript|main|final|article|unknown|无标题)(?:[\s_\d.-]*)', text, re.I):
        return False
    if re.search(r'^(?:Microsoft\s+(?:Word|PowerPoint)|LaTeX|Adobe\s+Acrobat|Acrobat\s+Distiller)\b|\.(?:pdf|docx?|tex|dvi|ps|pptx?)$', text, re.I):
        return False
    if re.search(r'https?://|www\.|@|\b(?:doi\s*:|arxiv\s*:|ISSN\b|ISBN\b|ORCID\b)', text, re.I):
        return False
    if re.match(r'^(?:abstract|keywords?|references|bibliography|摘要|关键词|参考文献)(?:\b|\s|[:：])', text, re.I):
        return False
    if re.fullmatch(r'(?:\d+[.)]?\s*)?(?:introduction|conclusions?|acknowledg(?:e)?ments?|appendix|引言|结论)', text, re.I):
        return False
    if re.search(r'^(?:contents lists available|journal homepage|received\b|accepted\b|published\s+(?:online|by)|copyright\b|©|all rights reserved|to cite this article|please cite)', text, re.I):
        return False
    if re.search(r'^(?:IEEE\s+TRANSACTIONS\b|PROCEEDINGS\s+OF\b|JOURNAL\s+OF\b|(?:INTERNATIONAL|EUROPEAN|AMERICAN|CHINESE)\s+JOURNAL\b)|\b(?:university|department of|school of|institute of|press inc\b)', text, re.I):
        return False
    if re.fullmatch(r'(?:Elsevier|Springer(?:\s+Nature)?|ScienceDirect|Wiley|Taylor\s*&\s*Francis|Nature|Research\s+Article|Original\s+Article|Article|Open\s+Access)', text, re.I):
        return False
    return not re.fullmatch(r'[\w.-]+_+[\w._-]+', text)


def _page_lines(page):
    lines=[]
    for block_id,block in enumerate(page.get_text('dict', sort=True)['blocks']):
        for line in block.get('lines', []):
            spans=[s for s in line['spans'] if s['text'].strip()]
            text=_clean_text(''.join(s['text'] for s in line['spans']))
            if not text or not spans:continue
            substantial=[s for s in spans if len(re.findall(r'[A-Za-z\u3400-\u9fff]', s['text']))>=3] or spans
            lines.append({'text':text,'box':fitz.Rect(line['bbox']),'size':max(s['size'] for s in substantial),
                          'bold':any(s['flags']&16 for s in substantial),'block':block_id})
    return lines


def _title_candidates(document, pages):
    candidates=[]
    metadata=_clean_text((document.metadata or {}).get('title',''))
    first_text=' '.join(line['text'] for line in pages[0]) if pages else ''
    visible_text=' '.join(line['text'] for lines in pages for line in lines)
    if _plausible_title(metadata):
        # Good embedded titles are useful, but publisher templates / stale Word
        # metadata must not outrank the actual prominent title on the page.
        matched=_title_key(metadata) in _title_key(visible_text)
        candidates.append((110 if matched else 90 if not first_text.strip() else 38, metadata))
        if not first_text.strip():return [metadata]
    for page_index,lines in enumerate(pages):
        if not lines:continue
        height=document[page_index].rect.height
        sizes=Counter()
        for line in lines:
            if len(line['text'])>=25:sizes[round(line['size'],1)]+=len(line['text'])
        body=min(12,sizes.most_common(1)[0][0]) if sizes else 10
        groups=[]
        for line in lines:
            if line['box'].y0>height*.65:continue
            previous=groups[-1][-1] if groups else None
            if (previous and _plausible_title(line['text']) and _plausible_title(previous['text'])
                    and abs(line['size']-previous['size'])<max(1,line['size']*.12)
                    and -line['size']*.35<=line['box'].y0-previous['box'].y1<=line['size']*1.1
                    and line['box'].y0>previous['box'].y0+line['size']*.5
                    and (line['block']==previous['block'] or line['size']>body*1.15)
                    and len(' '.join(x['text'] for x in groups[-1]))+len(line['text'])<350):
                groups[-1].append(line)
            else:groups.append([line])
        largest=max((max(line['size'] for line in group) for group in groups if _plausible_title(' '.join(line['text'] for line in group))),default=body)
        for group in groups:
            text=_clean_text(' '.join(line['text'] for line in group))
            if not _plausible_title(text):continue
            size=max(line['size'] for line in group);top=group[0]['box'].y0/height
            if (len(group)>1 and size<largest*.8 and all(re.fullmatch(r"(?:[A-ZÀ-Ž][\w’'-]+\s+){1,3}[A-ZÀ-Ž][\w’'-]+",line['text']) for line in group)):
                continue
            # Body paragraphs and author rows must not become fallback queries.
            if size<body*1.1 and (len(group)>2 or len(text)>170 or top>.4):continue
            score=30+min(40,max(-10,(size/body-1)*40))+max(0,15-top*30)
            score+=25*size/largest
            if size<largest*.8:score-=25
            if any(line['bold'] for line in group):score+=6
            if re.search(r'(?:[,;].*){2}|\b(?:and|&)\b.*\d',text):score-=15
            if len(text)<12 and not re.search(r'[\u3400-\u9fff]{4}',text):score-=20
            if size<=body*1.15 and not any(line['bold'] for line in group):score-=20
            score-=page_index*20
            if score>=48:candidates.append((score,text))
        # Only inspect the second page's typography for a genuine cover sheet.
        if candidates and max(score for score,_ in candidates)>=55:break
    result=[];seen=set()
    for score,title in sorted(candidates,reverse=True):
        key=_title_key(title)
        if key not in seen:
            seen.add(key);result.append(title)
    return result[:3]


_DOI=re.compile(r'\b10\.\d{4,9}/[^\s<>"{}]+',re.I)


def _dois(text):
    # DOI URLs often wrap after a slash/hyphen. Keep the suffix's hyphen; it is
    # part of the identifier rather than a prose hyphenation decision.
    text=re.sub(r'(?<=[/-])\s*\n\s*(?=[A-Za-z0-9])','',unquote(text)).replace('\u00ad','')
    for match in _DOI.finditer(text):
        value=match[0].rstrip('.,;:，。；')
        for left,right in (('(',')'),('[',']')):
            while value.endswith(right) and value.count(right)>value.count(left):value=value[:-1]
        if len(value)<=200:yield value,match.start()


def research_identifiers(path):
    with fitz.open(path) as document:
        pages=[_page_lines(document[i]) for i in range(min(2,len(document)))]
        titles=_title_candidates(document,pages)
        candidates=[];arxiv=''
        # Publisher exports often put the article's DOI in Subject/Keywords,
        # even when the page labels it using "Digital Object Identifier".
        metadata_dois=list(_dois(' '.join((document.metadata or {}).get(key,'') for key in ('subject','keywords'))))
        unique_metadata={value.casefold():value for value,_ in metadata_dois}
        if len(unique_metadata)==1:
            candidates.append({'doi':next(iter(unique_metadata.values())),'source':'metadata','page':0,'score':110})
        for page_index,lines in enumerate(pages):
            page=document[page_index];reference_y=None
            text='\n'.join(line['text'] for line in lines)
            reference_heading=next((line for line in lines if re.fullmatch(r'(?:\d+[.]?\s*)?(?:references|bibliography|参考文献)',line['text'],re.I)),None)
            if reference_heading:reference_y=reference_heading['box'].y0
            reference_blocks={line['block'] for line in lines if re.match(r'^\s*\[\d+\]\s',line['text'])}
            def is_reference(line):
                return (reference_y is not None and line['box'].y0>=reference_y) or line['block'] in reference_blocks
            for index,line in enumerate(lines):
                if is_reference(line):continue
                # Retain adjacent-line wrapping only within the same PDF block.
                value=line['text']
                if index+1<len(lines) and line['block']==lines[index+1]['block'] and value.endswith(('/','-')):
                    value+='\n'+lines[index+1]['text']
                for doi,start in _dois(value):
                    explicit=bool(re.search(r'(?:doi\s*:|doi\.org/|Digital Object Identifier\s*:?)\s*$',value[:start],re.I))
                    # Second-page plain DOI strings are commonly citations.
                    if not explicit and (page_index or line['box'].y0>page.rect.height*.45):continue
                    score=(85 if explicit else 45)-page_index*30
                    candidates.append({'doi':doi,'source':'text','page':page_index+1,'score':score})
            for link in page.get_links():
                uri=link.get('uri','')
                if not re.match(r'https?://(?:dx\.)?doi\.org/',uri,re.I):continue
                rect=fitz.Rect(link['from'])
                overlapping=[line for line in lines if (line['box']&rect).get_area()>0]
                if any(is_reference(line) for line in overlapping) or (reference_y is not None and rect.y0>=reference_y):continue
                for doi,_ in _dois(uri.split('?',1)[0].split('#',1)[0]):
                    candidates.append({'doi':doi,'source':'link','page':page_index+1,'score':100-page_index*30})
            if not arxiv:
                identifier_text='\n'.join(line['text'] for line in lines if not is_reference(line))
                match=re.search(r'(?:arxiv\s*:\s*|arxiv.org/(?:abs|pdf)/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?/\d{7}(?:v\d+)?)',identifier_text,re.I)
                if match:arxiv=match[1]
        ranked=[];seen=set()
        for item in sorted(candidates,key=lambda item:item['score'],reverse=True):
            if item['doi'].casefold() not in seen:
                ranked.append(item);seen.add(item['doi'].casefold())
    return {'doi':ranked[0]['doi'] if ranked else '', 'arxiv':arxiv,
            'title':titles[0] if titles else '', 'titleCandidates':titles, 'doiCandidates':ranked[:5]}


def research_clip(path, page, rect=None, rects=None, image=False, formula=False):
    with fitz.open(path) as document:
        p = document[page]
        region = fitz.Rect(rect) if rect else p.rect * p.derotation_matrix
        bounds = p.rect * p.derotation_matrix
        if region.is_empty or not all(__import__('math').isfinite(v) for v in region) or not bounds.contains(region):
            raise ValueError('截图范围超出页面。')
        selected = [fitz.Rect(r) for r in rects] if rects else [region]
        lines, sizes = [], []
        for block in p.get_text('rawdict')['blocks']:
            for line in block.get('lines', []):
                chars = []
                for span in line.get('spans', []):
                    for char in span['chars']:
                        box = fitz.Rect(char['bbox'])
                        if any((box & r).get_area() >= box.get_area() * .5 for r in selected):
                            chars.append(char['c'])
                            if char['c'].strip(): sizes.append(span['size'])
                if chars: lines.append(''.join(chars))
        result = {'text': '\n'.join(lines), 'rect': list(region)}
        if image:
            # get_pixmap's clip is in rotated coordinates; selection geometry is not.
            # Read original PDF vectors, independent of reader zoom / dark mode.
            # Small subscripts need more pixels than body text. Bound memory for
            # accidental whole-page crops; never split matrices into text lines.
            scale = 2.5
            if formula:
                small = sorted(sizes)[len(sizes)//10] if sizes else 8
                scale = min(6, max(4, 32/max(small, 1)), 3072/max(region.width, region.height))
            pix = p.get_pixmap(matrix=fitz.Matrix(scale,scale), clip=region * p.rotation_matrix, alpha=False, annots=False)
            result['png'] = base64.b64encode(pix.tobytes('png')).decode('ascii')
        return result
