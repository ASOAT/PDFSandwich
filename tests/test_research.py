import io
import base64
import sys
from pathlib import Path
import pymupdf as fitz
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from research import research_clip,research_cover,research_identifiers


def test_clips_rotate_correctly_and_select_glyphs(tmp_path):
    path=tmp_path/'example.pdf'
    doc=fitz.open();page=doc.new_page(width=300,height=400)
    page.insert_text((30,70),'First line selected',fontsize=12)
    page.insert_text((30,110),'Second line excluded',fontsize=12)
    page.set_rotation(90);doc.save(path);doc.close()
    result=research_clip(str(path),0,rect=[25,50,200,80],image=True)
    assert 'First line selected' in result['text']
    assert 'Second line' not in result['text']
    image=Image.open(io.BytesIO(base64.b64decode(result['png'])))
    assert image.width in (75,76)
    assert image.height in (437,438)
    high=research_clip(str(path),0,rect=[25,50,200,80],image=True,formula=True)
    formula=Image.open(io.BytesIO(base64.b64decode(high['png'])))
    assert formula.width>image.width and formula.height>image.height
    assert high['text']==result['text']
    output=tmp_path/'cover.png';research_cover(str(path),str(output))
    assert Image.open(output).width==360


def test_identifiers(tmp_path):
    path=tmp_path/'paper.pdf'
    doc=fitz.open();page=doc.new_page();page.insert_text((40,50),'arXiv:1706.03762v7 DOI:10.1234/example')
    doc.set_metadata({'title':'A test paper title'});doc.save(path);doc.close()
    result=research_identifiers(str(path))
    assert result['arxiv']=='1706.03762v7';assert result['doi']=='10.1234/example'
