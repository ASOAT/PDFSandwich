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


def test_title_cut_inside_word_rejoins_before_translation_without_merging_columns():
    from prose_layout import join_fragmented_titles
    left=paragraph(line('Learning Hamilt',x=40,y=700),label='fallback_line')
    right=paragraph(line('onian Dynamics at Scale',x=115,y=700),label='title')
    other=paragraph(line('A Different Column',x=350,y=700),label='fallback_line')
    page=Page(pdf_paragraph=[left,right,other])
    join_fragmented_titles(page)
    assert len(page.pdf_paragraph)==2
    assert page.pdf_paragraph[0].unicode=='Learning Hamiltonian Dynamics at Scale'
    assert page.pdf_paragraph[0].layout_label=='title'
    assert page.pdf_paragraph[1] is other
    # A normal space between adjacent headings is not a broken word.
    left=paragraph(line('Results',x=40,y=700),label='fallback_line')
    right=paragraph(line('Discussion',x=80,y=700),label='title')
    page=Page(pdf_paragraph=[left,right]);join_fragmented_titles(page)
    assert len(page.pdf_paragraph)==2


def test_author_names_and_raised_affiliations_preserve_original_glyphs_only_in_title_block():
    from prose_layout import preserve_author_rows
    title=paragraph(line('A Scientific Paper Title',y=720),label='title')
    for c in title.pdf_paragraph_composition[0].pdf_line.pdf_character:c.pdf_style.font_size=14
    authors=paragraph(line('Alice Smith1 Bob Jones2',y=670))
    chars=authors.pdf_paragraph_composition[0].pdf_line.pdf_character
    for c in chars:
        if c.char_unicode.isdigit():
            c.pdf_style.font_size=7;c.box.y+=4;c.box.y2+=1
    abstract=paragraph(line('Abstract',y=630),label='title')
    body=paragraph(line('We consider a model1 for learning.',y=650))
    c=next(c for c in body.pdf_paragraph_composition[0].pdf_line.pdf_character if c.char_unicode=='1')
    c.pdf_style.font_size=7;c.box.y+=4
    page=Page(cropbox=Cropbox(box=Box(0,0,612,792)),pdf_paragraph=[title,authors,body,abstract])
    preserve_author_rows(page)
    assert page.pdf_character==chars and page.pdf_paragraph==[title,body,abstract]
    page=Page(cropbox=Cropbox(box=Box(0,0,612,792)),pdf_paragraph=[title,authors])
    preserve_author_rows(page)
    assert len(page.pdf_paragraph)==2 and not page.pdf_character


def test_prose_font_math_name_stays_with_its_hat_and_subscript():
    chars=line('an NOθ acting').pdf_character
    # A smaller theta is the only initially recognized piece of this formula.
    chars[5].pdf_style.font_size=6
    flags=[c.char_unicode=='θ' for c in chars]
    result=expand_math(chars,flags,set(),set())
    assert all(result[3:6]) and not any(result[:3]+result[6:])
    # A full English word adjacent to a formula must still be translated.
    chars=line('operatorθ').pdf_character;chars[-1].pdf_style.font_size=6
    result=expand_math(chars,[False]*8+[True],set(),set())
    assert result==[False]*8+[True]


def test_brackets_keep_consecutive_math_letters_and_subscripts_together():
    chars=line('Use (xt) and (ordinary x).').pdf_character
    flags=[False]*len(chars)
    for i,c in enumerate(chars):
        if c.char_unicode in 'xt' and i<8:c.pdf_style.font_id='math'
    result=expand_math(chars,flags,{'math'},set())
    assert all(result[4:8])
    assert not any(result[13:])


def test_numbered_items_have_separate_bodies_and_frozen_labels():
    from layout_atoms import split_numbered_lists
    p=paragraph(line('1. A nominal solver uses a model.',y=300),
                line('and computes a step.',x=55,y=285),
                line('2. A sensitivity solver computes derivatives.',y=265))
    p.render_order=100
    for i,comp in enumerate(p.pdf_paragraph_composition):
        for j,char in enumerate(comp.pdf_line.pdf_character):char.render_order=100+i*100+j
    page=Page(pdf_paragraph=[p]);split_numbered_lists(page)
    assert len(page.pdf_paragraph)==2
    assert ''.join(c.char_unicode for c in page.pdf_character)=='1. 2. '
    assert all(not p.unicode.startswith(('1.','2.')) and p.box.x==55 for p in page.pdf_paragraph)
    assert page.pdf_paragraph[0].box.y>page.pdf_paragraph[1].box.y2
    assert [p.render_order for p in page.pdf_paragraph]==[103,303]
    prose=paragraph(line('1. A single sentence is insufficient evidence.'))
    page=Page(pdf_paragraph=[prose]);split_numbered_lists(page)
    assert page.pdf_paragraph==[prose] and not page.pdf_character


def test_formula_atoms_rejoin_accents_scripts_fraction_rules_and_tall_brackets():
    from babeldoc.format.pdf.document_il.il_version_1 import PdfFormula, PdfCurve
    from babeldoc.format.pdf.document_il.utils.formular_helper import update_formula_data
    from babeldoc.format.pdf.document_il.midend.typesetting import TypesettingUnit
    from layout_atoms import join_formula_atoms
    def char(text,x,y,w,h,size=10,font='math'):
        box=Box(x,y,x+w,y+h)
        return PdfCharacter(char_unicode=text,box=box,visual_bbox=VisualBbox(box=copy.copy(box)),
                            pdf_style=PdfStyle(font_id=font,font_size=size),xobj_id=0)
    def formula(chars,line_id):
        f=PdfFormula(pdf_character=chars,line_id=line_id);update_formula_data(f)
        return PdfParagraphComposition(pdf_formula=f)
    import copy
    # An accent appears before an intervening prose composition in extraction
    # order, but it must move with the base on the next geometric line.
    base=char('M',40,100,9,9);accent=char('~',41,111,7,1)
    power=char('2',49,107,3,4,size=6)
    untouched=char('y',40,80,6,9)
    comps=[formula([accent],0),PdfParagraphComposition(pdf_line=line('text',x=10,y=100)),
           formula([base],1),formula([power],2),formula([untouched],3)]
    p=PdfParagraph(pdf_paragraph_composition=comps);page=Page(pdf_paragraph=[p])
    join_formula_atoms(page)
    atom=next(c.pdf_formula for c in comps if c.pdf_formula and base in c.pdf_formula.pdf_character)
    assert set(map(id,atom.pdf_character))=={id(base),id(accent),id(power)}
    assert comps[0].pdf_line and len([c for c in comps if c.pdf_formula])==2
    # Numerator, denominator and parentheses remain one unit through scaling.
    numerator=char('1',105,106,5,5,size=7);denominator=char('2',105,95,5,5,size=7)
    opening=char('(',100,94,3,19);closing=char(')',112,94,3,19)
    p=PdfParagraph(pdf_paragraph_composition=[formula([opening],0),formula([numerator],1),formula([denominator],2),formula([closing],3)])
    bar=PdfCurve(box=Box(104,103,111,103.3))
    page=Page(pdf_paragraph=[p],pdf_curve=[bar]);join_formula_atoms(page)
    assert len(p.pdf_paragraph_composition)==1
    atom=p.pdf_paragraph_composition[0].pdf_formula
    assert all(c.formula_layout_id for c in atom.pdf_character)
    atom.pdf_curve.append(bar)
    # Upstream relocation must apply one affine transform to the entire atom.
    atom.x_offset=0;atom.y_offset=0
    moved=TypesettingUnit(formular=atom).relocate(200,300,.8).formular
    for before,after in zip(atom.pdf_character,moved.pdf_character):
        assert abs(after.box.x-(200+(before.box.x-atom.box.x)*.8))<1e-6
        assert abs(after.box.y-(300+(before.box.y-atom.box.y)*.8))<1e-6
    assert moved.pdf_curve and abs((moved.pdf_curve[0].box.x2-moved.pdf_curve[0].box.x)-7*.8)<1e-6


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


def test_bibliography_finds_both_columns_even_with_a_narrow_shared_baseline():
    from layout_preservation import characters
    lines=[]
    for i in range(3):
        left=line(f'[{i+1}] Author. A reference title.',x=40,y=300-i*45)
        right=line(f'[{i+4}] Another author. Title.',x=left.box.x2+8,y=300-i*45)
        # A detector can put the two columns in a single paragraph.
        lines.extend([left,right])
    page=Page(cropbox=Cropbox(box=Box(0,0,612,792)),pdf_paragraph=[paragraph(*lines)])
    originals={id(c) for p in page.pdf_paragraph for c in characters(p) if c.char_unicode.strip()}
    split_references(page)
    refs=[p for p in page.pdf_paragraph if p.layout_label=='reference']
    assert len(refs)==6
    assert [p.unicode for p in refs]==['Author. A reference title.']*3+['Another author. Title.']*3
    assert ''.join(c.char_unicode for c in page.pdf_character)=='[1][2][3][4][5][6]'
    retained=[c for p in page.pdf_paragraph for c in characters(p)]+page.pdf_character
    assert len({id(c) for c in retained})==len(retained)
    assert originals<={id(c) for c in retained}


def test_fragmented_prose_rejoins_broken_words_without_merging_columns_or_heading():
    from prose_layout import join_fragmented_prose
    from layout_preservation import characters
    heading=paragraph(line('Neural operators',y=330),label='title')
    a=paragraph(line('Neura',y=300));b=paragraph(line('l',x=65,y=300),label='title')
    c=paragraph(line('operators provi',x=73,y=300));d=paragraph(line('d',x=148,y=300),label='title')
    body=paragraph(line('e a useful mapping',x=153,y=300),line('from functions to functions.',x=40,y=285))
    neighbor=paragraph(line('Other column.',x=400,y=300),line('Its continuation.',x=400,y=285))
    formula=paragraph(line('x + y = 1',x=40,y=260),label='formula')
    page=Page(pdf_paragraph=[heading,a,b,c,d,body,neighbor,formula])
    before={id(c) for p in page.pdf_paragraph for c in characters(p)}
    join_fragmented_prose(page)
    assert len(page.pdf_paragraph)==4
    assert page.pdf_paragraph[1].unicode=='Neural operators provide a useful mapping from functions to functions.'
    assert page.pdf_paragraph[0] is heading and page.pdf_paragraph[2] is neighbor and page.pdf_paragraph[3] is formula
    assert before.issubset({id(c) for p in page.pdf_paragraph for c in characters(p)})
    # Similar single-line cells are insufficient evidence of a broken paragraph.
    cells=[paragraph(line('data',x=40,y=100)),paragraph(line('table',x=60,y=100))]
    p=Page(pdf_paragraph=cells);join_fragmented_prose(p);assert len(p.pdf_paragraph)==2
