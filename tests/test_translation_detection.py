import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import pymupdf as fitz
from translation_detection import page_kind,document_profile

EN='This scientific paper describes a stable numerical method for solving nonlinear optimization problems efficiently.'
ZH='本文介绍一种求解非线性优化问题的数值方法，并分析算法的稳定性和计算效率。'


def text_page(doc,text,chinese=False):
    page=doc.new_page()
    page.insert_textbox(fitz.Rect(40,40,550,700),text,fontname='china-s' if chinese else 'helv',fontsize=12)
    return page


def test_chinese_body_with_english_abstract_and_citations_is_not_auto_translated():
    with fitz.open() as doc:
        text_page(doc,EN)
        for _ in range(4):text_page(doc,ZH*3+'\nTransformer MPC [1]',True)
        profile,pages=document_profile(doc)
        assert profile['kind']=='chinese' and pages[0]=='english'
        assert all(pages[i]=='chinese' for i in range(1,5))


def test_full_page_scan_with_selectable_footer_requires_ocr_but_ocr_layer_is_used():
    with fitz.open() as image_doc,fitz.open() as doc:
        image=text_page(image_doc,EN*4).get_pixmap().tobytes('png')
        page=doc.new_page();page.insert_image(page.rect,stream=image)
        page.insert_text((20,780),'Journal 2026 Page 1')
        assert page_kind(page)=='needs-ocr'
        page.insert_textbox(fitz.Rect(40,40,550,700),EN*4,render_mode=3)
        assert page_kind(page)=='english'


def test_blank_cover_does_not_disable_english_book_and_inspection_is_bounded():
    with fitz.open() as doc:
        doc.new_page()
        for _ in range(30):text_page(doc,EN*2)
        profile,pages=document_profile(doc)
        assert profile['kind']=='english' and pages[0]=='no-text'
        assert profile['sampledPages']<=16 and len(pages)<len(doc)


def test_mixed_scan_and_english_pages_are_classified_individually():
    with fitz.open() as image_doc,fitz.open() as doc:
        image=text_page(image_doc,ZH*3,True).get_pixmap().tobytes('png')
        page=doc.new_page();page.insert_image(page.rect,stream=image)
        text_page(doc,EN*2)
        profile,pages=document_profile(doc)
        assert profile['kind']=='english' and pages=={0:'needs-ocr',1:'english'}


def test_inspection_does_not_load_translation_dependencies(tmp_path):
    import subprocess,json
    path=tmp_path/'chinese.pdf'
    with fitz.open() as doc:
        text_page(doc,ZH*3,True);doc.save(path)
    code="import sys,json;sys.path.insert(0,'backend');import pdf_ops;info=pdf_ops.inspect(sys.argv[1]);print(json.dumps({'kind':info['translationProfile']['kind'],'loaded':[x for x in ('translate','text_engine','hy_model','babeldoc','onnxruntime') if x in sys.modules]}))"
    result=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True,text=True,check=True,cwd=Path(__file__).resolve().parents[1])
    assert json.loads(result.stdout)=={'kind':'chinese','loaded':[]}
