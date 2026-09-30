import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from babeldoc.format.pdf.document_il.il_version_1 import (
    Box, Cropbox, Page, PdfCharacter, PdfFont, PdfLine, PdfParagraph,
    PdfParagraphComposition, PdfStyle, VisualBbox)
from layout_preservation import expand_math, math_fonts, protect_heading_number
from reference_layout import split_references, explicit_word_spaces


def line(text, x=40, y=300, font='text'):
    chars = []
    for value in text:
        b = Box(x, y, x+5, y+10)
        chars.append(PdfCharacter(char_unicode=value, box=b, visual_bbox=VisualBbox(box=b),
                                  pdf_style=PdfStyle(font_id=font, font_size=10), xobj_id=0))
        x += 5
    return PdfLine(box=Box(chars[0].box.x,y,x,y+10),pdf_character=chars)


def paragraph(*lines, label='plain text', text=None):
    return PdfParagraph(box=Box(min(l.box.x for l in lines), min(l.box.y for l in lines),
                               max(l.box.x2 for l in lines), max(l.box.y2 for l in lines)),
                        pdf_paragraph_composition=[PdfParagraphComposition(pdf_line=l) for l in lines],
                        unicode=text or ' '.join(''.join(c.char_unicode for c in l.pdf_character) for l in lines),
                        layout_label=label, xobj_id=0, debug_id='test')


def test_balanced_math_operators_and_braces_are_protected_but_prose_is_not():
    text='The rate O(1/x log(1/x)) and {x} (ordinary words)'
    chars=line(text).pdf_character
    flags=[c in '1/x{}' for c in text]
    result=expand_math(chars,flags,set(),set())
    assert all(result[text.index('('):text.index(' and')])
    assert all(result[text.index('{'):text.index('}')+1])
    assert not any(result[text.index('(ordinary'):])


def test_heading_prefix_does_not_consume_first_capital_of_title():
    p=paragraph(line('4.2 Model-based Diffusion'),label='title')
    page=Page(pdf_paragraph=[p])
    protect_heading_number(page)
    assert p.unicode=='Model-based Diffusion'
    assert ''.join(c.char_unicode for c in page.pdf_character)=='4.2 '
    assert p.box.x==60


def test_roman_tex_body_font_is_not_globally_classified_as_math():
    p=paragraph(line('Regular scientific prose written using Computer Modern Roman.',font='roman'))
    page=Page(pdf_paragraph=[p],pdf_font=[PdfFont(font_id='roman',name='ABCDEF+CMR10')])
    assert math_fonts(page)==(set(),set())


def test_implicit_spaces_are_preserved_before_style_splitting():
    first=line('Gauthier',x=40).pdf_character
    second=line('Gidel',x=first[-1].box.x2+2).pdf_character
    assert ''.join(c.char_unicode for c in explicit_word_spaces(first+second))=='Gauthier Gidel'
    assert ''.join(c.char_unicode for c in explicit_word_spaces(first))=='Gauthier'


def test_bibliography_rejoins_split_words_and_preserves_number_margin():
    lines=[line('[6] Amy Smith. First title.',y=300),line('[7] Ben Lee. Second title.',y=270),
           line('[8] Peter I. Frazier. A Tutorial on Ba',y=240)]
    p=paragraph(*lines)
    tail=paragraph(line('yesian Optimization, July 2018.',x=lines[-1].box.x2,y=240))
    page=Page(cropbox=Cropbox(box=Box(0,0,612,792)),pdf_paragraph=[p,tail])
    originals={id(c) for entry in page.pdf_paragraph for comp in entry.pdf_paragraph_composition for c in comp.pdf_line.pdf_character}
    spaces={id(c) for l in lines for c in l.pdf_character if c.char_unicode==' ' and c.box.x==55}
    split_references(page)
    refs=[p for p in page.pdf_paragraph if p.layout_label=='reference']
    assert len(refs)==3
    assert 'Bayesian Optimization' in refs[-1].unicode
    assert refs[-1].unicode.startswith('Peter I. Frazier.')
    assert all(p.box.x>40 for p in refs)
    retained=[c for p in refs for comp in p.pdf_paragraph_composition for c in comp.pdf_line.pdf_character]+page.pdf_character
    assert len({id(c) for c in retained})==len(retained)
    # Only leading whitespace after the frozen labels may be discarded.
    assert originals-{id(c) for c in retained} == spaces
