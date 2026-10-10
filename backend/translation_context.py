"""Small, immutable paragraph context built before parallel translation starts."""
import json
import re

PREFIX = '\x1econtext\x1f'


def page_edges(request):
    path, index = request.get('documentPath'), request.get('pageIndex')
    if not path or not isinstance(index, int):
        return {}
    import pymupdf as fitz
    with fitz.open(path) as doc:
        before=doc[index-1].get_text(sort=True)[-600:] if index>0 else ''
        after=doc[index+1].get_text(sort=True)[:300] if index+1<len(doc) else ''
    return {'before':before,'after':after}


def contexts_for_page(page, edges=None):
    paragraphs=[p for p in page.pdf_paragraph if p.box and p.unicode and p.layout_label not in ('abandon','reference')]
    result={};edges=edges or {}
    def overlap(a,b):
        return max(0,min(a.x2,b.x2)-max(a.x,b.x)) >= min(a.x2-a.x,b.x2-b.x)*.3
    for p in paragraphs:
        if not re.match(r'^\s*(?:where|here|this|these|those|it|they|thus|therefore|which|and|with)\b',p.unicode,re.I):
            continue
        above=[q for q in paragraphs if q is not p and overlap(p.box,q.box) and q.box.y>=p.box.y2-2]
        below=[q for q in paragraphs if q is not p and overlap(p.box,q.box) and q.box.y2<=p.box.y+2]
        before=min(above,key=lambda q:q.box.y-p.box.y2).unicode if above else edges.get('before','')
        after=min(below,key=lambda q:p.box.y-q.box.y2).unicode if below else edges.get('after','')
        formula=any(l.box and l.class_name=='isolate_formula' and overlap(p.box,l.box) and
                    -2<=l.box.y-p.box.y2<=65 for l in page.page_layout)
        result[id(p)]={'before':before[-280:],'after':after[:140],'precededByFormula':formula}
    return result


def envelope(text, context):
    return PREFIX+json.dumps(context,ensure_ascii=False)+'\x1f'+text if context else text


def unpack(text):
    if not text.startswith(PREFIX):
        return text,{}
    raw,text=text[len(PREFIX):].split('\x1f',1)
    return text,json.loads(raw)
