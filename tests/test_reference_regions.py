"""Bibliography recovery must not claim text belonging to another region."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from babeldoc.format.pdf.document_il.il_version_1 import (
    Box, Cropbox, Page, PdfCharacter, PdfLine, PdfParagraph,
    PdfParagraphComposition, PdfStyle, VisualBbox)
from layout_preservation import characters
from reference_layout import split_references


def line(text, x=40, y=300):
    chars = []
    for text_char in text:
        box = Box(x, y, x+5, y+10)
        chars.append(PdfCharacter(char_unicode=text_char, box=box,
                                 visual_bbox=VisualBbox(box=box), xobj_id=0,
                                 pdf_style=PdfStyle(font_id='text', font_size=10)))
        x += 5
    return PdfLine(box=Box(chars[0].box.x,y,x,y+10),pdf_character=chars)


def paragraph(*lines, label='plain text'):
    return PdfParagraph(
        box=Box(min(l.box.x for l in lines),min(l.box.y for l in lines),
                max(l.box.x2 for l in lines),max(l.box.y2 for l in lines)),
        unicode=' '.join(''.join(c.char_unicode for c in l.pdf_character) for l in lines),
        layout_label=label, xobj_id=0,
        pdf_paragraph_composition=[PdfParagraphComposition(pdf_line=l) for l in lines])


def page(*paragraphs):
    return Page(cropbox=Cropbox(box=Box(0,0,612,792)),pdf_paragraph=list(paragraphs))


def ownership(document):
    return [id(c) for p in document.pdf_paragraph for c in characters(p)]+[id(c) for c in document.pdf_character]


def test_inline_citations_never_capture_neighboring_caption_or_prose():
    # The AnyCar failure: aligned increasing inline citations in the left
    # column were mistaken for labels and consumed half of both columns.
    for numbers in [(5,11,18),(5,6,7)]:
        left=paragraph(*(line(f'Prior work [{n}] describes a useful model.',y=300-i*20)
                         for i,n in enumerate(numbers)))
        caption=paragraph(line('Fig. 1: A caption beside the introduction.',x=320,y=280),label='figure_caption')
        right=paragraph(line('Independent right-column prose.',x=320,y=240))
        document=page(left,caption,right);before=ownership(document)
        text=[p.unicode for p in document.pdf_paragraph]
        split_references(document)
        assert document.pdf_paragraph==[left,caption,right]
        assert ownership(document)==before
        assert [p.unicode for p in document.pdf_paragraph]==text


def test_detached_inline_citation_fragments_are_not_line_start_labels():
    parts=[]
    for i in range(3):
        y=300-i*30
        prefix=line('We use',y=y)
        parts.extend([paragraph(prefix),paragraph(line(f'[{i+1}] in our method.',x=prefix.box.x2+2,y=y))])
    document=page(*parts);before=ownership(document)
    split_references(document)
    assert document.pdf_paragraph==parts and ownership(document)==before


def test_scattered_wrapped_line_start_citations_do_not_form_a_bibliography():
    body=paragraph(*(line(f'[{n}] provide another experiment.',y=300-i*30)
                     for i,n in enumerate([3,9,17])))
    document=page(body);before=ownership(document)
    split_references(document)
    assert document.pdf_paragraph==[body] and ownership(document)==before


def test_reference_transfer_keeps_captions_and_equations_as_barriers():
    refs=paragraph(*(line(f'[{i+1}] Author. Paper.',y=300-i*30) for i in range(3)))
    caption=paragraph(line('Fig. 2: Cannot become a reference.',x=200,y=280),label='figure_caption')
    equation=paragraph(line('x = y + z',x=70,y=250),label='formula')
    title=paragraph(line('NEXT SECTION',x=40,y=220),label='title')
    document=page(refs,caption,equation,title)
    protected={id(c) for p in [caption,equation,title] for c in characters(p)}
    split_references(document)
    found=[p for p in document.pdf_paragraph if p.layout_label=='reference']
    assert len(found)==3
    assert not protected.intersection(id(c) for p in found for c in characters(p))
    assert all(p in document.pdf_paragraph for p in [caption,equation,title])
    assert len(ownership(document))==len(set(ownership(document)))


def test_reference_region_does_not_slice_a_body_line_in_half():
    refs=paragraph(*(line(f'[{i+1}] Author. Paper.',x=180,y=300-i*30) for i in range(3)))
    body=paragraph(line('A body line starts outside the reference column and overlaps it.',x=40,y=280))
    document=page(refs,body);original=list(characters(body))
    split_references(document)
    assert body in document.pdf_paragraph and list(characters(body))==original
    found=[p for p in document.pdf_paragraph if p.layout_label=='reference']
    assert len(found)==3 and all('body line' not in p.unicode for p in found)


def test_two_columns_with_hanging_indents_and_midword_fragments_keep_unique_ownership():
    parts=[]
    for x,start in [(40,1),(320,4)]:
        for i in range(3):
            y=300-i*50
            first=line(f'[{start+i}] Author. Study.',x=x,y=y)
            body=line('A long reference continues.',x=x+20,y=y-15)
            parts.append(paragraph(first,body))
    tail=line('Extra detail.',x=parts[-1].pdf_paragraph_composition[-1].pdf_line.box.x2,y=185)
    parts.append(paragraph(tail))
    document=page(*parts)
    before={id(c) for p in parts for c in characters(p) if c.char_unicode.strip()}
    split_references(document)
    refs=[p for p in document.pdf_paragraph if p.layout_label=='reference']
    assert len(refs)==6
    assert all(p.box.x2<320 for p in refs[:3])
    assert all(p.box.x>=340 for p in refs[3:])
    assert 'Extra detail.' in refs[-1].unicode
    after=ownership(document)
    assert len(after)==len(set(after)) and before<=set(after)


def test_remaining_source_paragraph_has_current_text_and_geometry():
    mixed=paragraph(line('Body before references.',y=350),
                    *(line(f'[{i+1}] Author. Paper.',y=300-i*30) for i in range(3)))
    document=page(mixed)
    split_references(document)
    assert mixed.unicode=='Body before references.'
    assert mixed.box.y==350 and mixed.box.y2==360
    assert len(document.pdf_paragraph)==4


def test_ambiguous_source_ownership_is_not_committed_as_new_references():
    refs=paragraph(*(line(f'[{i+1}] Author. Paper.',y=300-i*30) for i in range(3)))
    document=page(refs)
    document.pdf_character.append(next(characters(refs)))
    before=ownership(document)
    split_references(document)
    assert document.pdf_paragraph==[refs] and ownership(document)==before
