"""Local PDF layout diagnostics. Never modifies input or calls a cloud API."""
import argparse
import asyncio
from collections import Counter
import json
import logging
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))


def snapshot(page):
    from layout_preservation import characters
    paragraphs = []
    for p in page.pdf_paragraph:
        chars = [c for c in characters(p) if (c.char_unicode or '').strip()]
        paragraphs.append({'label': p.layout_label, 'id': p.debug_id,
            'box': [p.box.x, p.box.y, p.box.x2, p.box.y2],
            'glyphs': [[c.char_unicode, c.box.x, c.box.y, c.box.x2, c.box.y2] for c in chars]})
    return paragraphs


def metrics(paragraphs):
    # Compare different text regions; glyph overlap inside a formula is legal.
    collisions = 0
    def area(b): return max(0,b[2]-b[0])*max(0,b[3]-b[1])
    def intersection(a,b): return area([max(a[0],b[0]),max(a[1],b[1]),min(a[2],b[2]),min(a[3],b[3])])
    for i,p in enumerate(paragraphs):
        for q in paragraphs[i+1:]:
            if not intersection(p['box'],q['box']): continue
            for a in p['glyphs']:
                for b in q['glyphs']:
                    minimum=min(area(a[1:]),area(b[1:]))
                    if minimum and intersection(a[1:],b[1:])/minimum>.25: collisions+=1
    return {'paragraphs':len(paragraphs), 'references':sum(p['label']=='reference' for p in paragraphs),
            'captions':sum(p['label']=='figure_caption' for p in paragraphs),
            'crossRegionGlyphCollisions':collisions}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',required=True);parser.add_argument('--pages',default='1')
    parser.add_argument('--output',required=True);parser.add_argument('--keep-stages',action='store_true')
    args=parser.parse_args();out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
    import pymupdf as fitz
    from layout_runtime import install
    install()
    from babeldoc.format.pdf.document_il.midend.styles_and_formulas import StylesAndFormulas
    from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting
    before_style=StylesAndFormulas.process_page;before_render=Typesetting.render_page
    stages={}
    def style(self,page):
        stages['source']=snapshot(page)
        result=before_style(self,page);stages['structured']=snapshot(page);return result
    def render(self,page):
        result=before_render(self,page);stages['rendered']=snapshot(page);return result
    StylesAndFormulas.process_page=style;Typesetting.render_page=render
    from translate import translate_request
    results=[]
    with fitz.open(args.input) as document:
        for number in map(int,args.pages.split(',')):
            folder=out/str(number);folder.mkdir(exist_ok=True);stages.clear()
            with fitz.open() as page:
                page.insert_pdf(document,from_page=number-1,to_page=number-1);page.save(folder/'source.pdf')
                page[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(folder/'source.png')
            request={'id':number,'input':str(folder/'source.pdf'),'output':str(folder/'translated.pdf'),
              'force':True,'modelDir':str(ROOT/'local-data/models'),
              'settings':{'provider':'local','localEngine':'hy','useGlossary':True,'glossary':''}}
            events=[]
            asyncio.run(translate_request(request,events.append))
            with fitz.open(folder/'translated.pdf') as page:
                page[0].get_pixmap(matrix=fitz.Matrix(1.5,1.5)).save(folder/'translated.png')
            item={'page':number,'stages':{k:metrics(v) for k,v in stages.items()},
                  'quality':json.loads((folder/'quality.json').read_text(encoding='utf8'))}
            results.append(item)
            if args.keep_stages:(folder/'stages.json').write_text(json.dumps(stages,ensure_ascii=False),encoding='utf8')
            print(json.dumps(item,ensure_ascii=False),flush=True)
    (out/'report.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf8')


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf8');logging.disable(logging.CRITICAL);main()
