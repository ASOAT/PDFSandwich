import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
import pymupdf as fitz
from scan_layout import is_searchable_scan, background_color, raster_formula, subtract_boxes
from babeldoc.format.pdf.document_il.il_version_1 import (
    Box, GraphicState, PdfFormula, PdfForm, PdfMatrix, PdfFormSubtype, PdfXobjForm)
from test_layout_preservation import line

TEXT = 'This book introduces classical mechanics and the physical principles governing motion.'


def scan_doc(hidden=True, text=TEXT):
    with fitz.open() as visual:
        page = visual.new_page(width=300, height=400)
        page.draw_rect(page.rect, color=None, fill=(.91, .90, .89))
        page.insert_text((30, 60), TEXT[:45], fontsize=10)
        image = page.get_pixmap(matrix=fitz.Matrix(2, 2)).tobytes('png')
    doc = fitz.open()
    page = doc.new_page(width=300, height=400)
    page.insert_textbox(fitz.Rect(30, 40, 280, 150), text, render_mode=3 if hidden else 0)
    page.insert_image(page.rect, stream=image)  # scan drawn AFTER invisible text
    return doc


def test_only_reliable_hidden_text_on_scan_activates_scan_layout():
    from translation_detection import page_kind, document_profile
    with scan_doc() as doc:
        assert is_searchable_scan(doc[0])
        assert page_kind(doc[0]) == 'english'
        assert document_profile(doc)[0]['searchableScan']
        assert all(abs(a-b)<.015 for a,b in zip(background_color(doc[0]),(.91,.90,.89)))
    with scan_doc(hidden=False) as doc:
        assert not is_searchable_scan(doc[0])  # native text with a background
    with scan_doc(text='Page 12') as doc:
        assert not is_searchable_scan(doc[0])
        assert page_kind(doc[0]) == 'needs-ocr'
    with fitz.open() as doc:
        doc.new_page().insert_text((30, 60), TEXT)
        assert not is_searchable_scan(doc[0])


def test_erasure_does_not_clip_page_number_or_figure():
    box=Box(20,20,150,100)
    protected=[Box(140,90,160,105),Box(20,20,50,50)]
    parts=subtract_boxes(box,protected)
    assert parts
    for part in parts:
        for item in protected:
            assert (part & fitz.Rect(item.x,item.y,item.x2,item.y2)).is_empty
    assert any(part.contains(fitz.Point(80,70)) for part in parts)


def test_inline_formula_reuses_original_image_clip_at_relocated_position():
    from babeldoc.format.pdf.document_il.backend.pdf_creater import FormRenderUnit
    from babeldoc.format.pdf.document_il.midend.typesetting import TypesettingUnit
    from bitstring import BitStream
    # Synthetic scan: colored formula region and a neighboring red figure.
    with fitz.open() as visual:
        p=visual.new_page(width=100,height=100)
        p.draw_rect(fitz.Rect(10,70,20,80),color=None,fill=(0,.5,0))
        p.draw_rect(fitz.Rect(60,60,90,90),color=None,fill=(1,0,0))
        image=p.get_pixmap(matrix=fitz.Matrix(3,3)).tobytes('png')
    with fitz.open() as output:
        p=output.new_page(width=100,height=100)
        xref=p.insert_image(p.rect,stream=image)
        resource=p.get_images()[0][7]
        form=PdfForm(box=Box(0,0,100,100),graphic_state=GraphicState(passthrough_per_char_instruction=''),
                     pdf_matrix=PdfMatrix(a=100,b=0,c=0,d=100,e=0,f=0),xobj_id=0,
                     pdf_form_subtype=PdfFormSubtype(pdf_xobj_form=PdfXobjForm(xref_id=xref,do_args=resource)),
                     form_type='image',render_order=200)
        formula=PdfFormula(box=Box(10,20,20,30),pdf_character=line('xy',x=10,y=20).pdf_character,
                           x_offset=0,y_offset=0,x_advance=0)
        raster_formula(formula,[form])
        assert len(formula.pdf_form)==1
        assert all(c.pdf_style.graphic_state.passthrough_per_char_instruction=='3 Tr' for c in formula.pdf_character)
        moved=TypesettingUnit(formular=formula).relocate(40,50,1)
        stream=BitStream()
        FormRenderUnit(moved.formular.pdf_form[0],1000).render(stream,None)
        output.update_stream(p.get_contents()[0],stream.tobytes())
        pixels=p.get_pixmap()
        assert pixels.pixel(45,45)[1] in range(120,135)  # green crop moved to new formula position
        assert pixels.pixel(15,75)==(255,255,255)  # no old formula remains
        assert pixels.pixel(75,75)==(255,255,255)  # other scan content was clipped out


def test_toc_scan_masks_changed_rows_without_erasing_page_numbers(tmp_path):
    from toc_layout import translate_contents
    with fitz.open() as visual:
        p=visual.new_page(width=300,height=400)
        for i in range(6):
            p.insert_text((30,50+i*35),'Introduction ................',fontsize=10)
            p.insert_text((250,50+i*35),str(i+1),fontsize=10)
        pix=p.get_pixmap(matrix=fitz.Matrix(2,2)).tobytes('png')
        with fitz.open() as doc:
            q=doc.new_page(width=300,height=400)
            for i in range(6):
                q.insert_text((30,50+i*35),'Introduction ................',fontsize=10,render_mode=3)
                q.insert_text((250,50+i*35),str(i+1),fontsize=10,render_mode=3)
            q.insert_image(q.rect,stream=pix)
            source=tmp_path/'contents.pdf';doc.save(source)
        output=tmp_path/'translated.pdf'
        result=translate_contents(source,output,lambda text:'引言',lambda *_:None)
        assert result['translated']==6
        with fitz.open(output) as translated:
            assert '引言' in translated[0].get_text()
            # Original final letters at x=60..80 are now blank, while the page
            # number's bitmap is byte-identical to the source scan.
            assert translated[0].get_pixmap(clip=fitz.Rect(65,41,80,47)).samples == bytes([255])*15*6*3
            with fitz.open(source) as original:
                clip=fitz.Rect(245,38,265,54)
                assert translated[0].get_pixmap(clip=clip).samples==original[0].get_pixmap(clip=clip).samples
