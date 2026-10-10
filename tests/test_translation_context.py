import sys
from pathlib import Path
from types import SimpleNamespace as NS
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from translation_context import contexts_for_page,envelope,unpack,page_edges
from translation_structure import scientific_literals
from translation_quality import translation_prompt
from test_translation_recovery import engine_at
import pymupdf as fitz


def paragraph(text,x,y,width=200):
    return NS(unicode=text,box=NS(x=x,x2=x+width,y=y,y2=y+20),layout_label='plain text')


def test_context_uses_same_column_and_nearest_equation_not_processing_order():
    before=paragraph('Define a linear system.',30,650)
    where=paragraph('where the coefficients satisfy a bound.',30,580)
    other=paragraph('An unrelated right column.',330,645)
    after=paragraph('This system is stable.',30,540)
    formula=NS(class_name='isolate_formula',box=NS(x=60,x2=180,y=620,y2=640))
    page=NS(pdf_paragraph=[other,after,where,before],page_layout=[formula])
    context=contexts_for_page(page)[id(where)]
    assert context=={'before':before.unicode,'after':after.unicode,'precededByFormula':True}
    assert scientific_literals(where.unicode,context)==[(0,5,'其中')]
    assert scientific_literals('where {v0} denotes the mass.')==[(0,5,'其中')]
    assert scientific_literals('Where is the robot located?')==[]
    assert scientific_literals('The place where the robot moves.')==[]
    assert unpack(envelope(where.unicode,context))==(where.unicode,context)
    prompt=translation_prompt(where.unicode,context=context)
    assert before.unicode in prompt and '只输出当前段' in prompt


def test_cross_page_context_and_context_sensitive_cache(tmp_path):
    file=tmp_path/'paper.pdf'
    with fitz.open() as pdf:
        for text in ['The equation defines energy.', 'where the mass is constant.', 'Next chapter.']:
            pdf.new_page().insert_text((40,70),text)
        pdf.save(file)
    edges=page_edges({'documentPath':str(file),'pageIndex':1})
    assert 'energy' in edges['before'] and 'Next chapter' in edges['after']
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda text:(calls.append(dict(engine.context)) or '它保持恒定。')
    try:
        a=envelope('It remains constant.',{'before':'Mass is defined above.'})
        b=envelope('It remains constant.',{'before':'Energy is defined above.'})
        engine.translate(a);engine.translate(b);engine.translate(a)
        assert len(calls)==2 and calls[0]!=calls[1] and engine.context=={}
    finally:engine.close()
