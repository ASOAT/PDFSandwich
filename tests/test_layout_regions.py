import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from babeldoc.format.pdf.document_il.il_version_1 import (
    Box, Cropbox, Page, PageLayout, PdfCharacter, PdfLine, PdfParagraph,
    PdfParagraphComposition, PdfStyle, VisualBbox)
from layout_regions import checked_rewrite, preserve_figure_text


def paragraph(text, x, y=100, label='plain text', region=None):
    chars = []
    for value in text:
        box = Box(x, y, x+5, y+10)
        chars.append(PdfCharacter(char_unicode=value, box=box, visual_bbox=VisualBbox(box=box),
                                  pdf_style=PdfStyle(font_id='text', font_size=10), xobj_id=0))
        x += 5
    box = Box(chars[0].box.x, y, x, y+10)
    line = PdfLine(box=box, pdf_character=chars)
    return PdfParagraph(box=box, layout_id=region, layout_label=label, xobj_id=0,
                        pdf_paragraph_composition=[PdfParagraphComposition(pdf_line=line)])


def chars(p):
    return p.pdf_paragraph_composition[0].pdf_line.pdf_character


def merge(page):
    first, second = page.pdf_paragraph
    chars(first).extend(chars(second))
    page.pdf_paragraph = [first]


def test_duplicate_or_lost_visible_glyphs_restore_exact_input_containers():
    for mutation, reason in ((lambda cs: cs.append(cs[0]), 'added_or_duplicate_glyphs'),
                             (lambda cs: cs.pop(), 'lost_glyphs')):
        original = paragraph('Source words', 40)
        page = Page(pdf_paragraph=[original])
        expected = list(chars(original))
        def corrupt(target):
            mutation(chars(target.pdf_paragraph[0]))
            target.pdf_paragraph[0].box.x = 999
            target.pdf_paragraph[0].pdf_paragraph_composition[0].pdf_line.box.y = 999
            target.pdf_paragraph[0].unicode = 'Partial rewrite'
        result = checked_rewrite(page, corrupt)
        assert not result['accepted'] and reason in result['reasons']
        assert page.pdf_paragraph[0] is original
        assert chars(original) == expected and original.box.x == 40
        assert original.pdf_paragraph_composition[0].pdf_line.box.y == 100
        assert original.unicode is None


def test_synthetic_spaces_and_moving_number_to_passthrough_are_permitted():
    page = Page(pdf_paragraph=[paragraph('1Example', 40)])
    def reformat(target):
        source = chars(target.pdf_paragraph[0])
        target.pdf_character.append(source.pop(0))
        import copy
        space = copy.copy(source[0]); space.char_unicode = ' '
        source.insert(2, space)
    assert checked_rewrite(page, reformat)['accepted']
    assert page.pdf_character[0].char_unicode == '1'


def test_body_and_caption_cannot_be_merged_even_if_adjacent():
    page = Page(pdf_paragraph=[paragraph('Text content', 40),
                              paragraph('Figure label', 100, label='figure_caption')])
    result = checked_rewrite(page, merge)
    assert result['reasons'] == ['mixed_body_and_caption']
    assert len(page.pdf_paragraph) == 2


def test_distant_columns_cannot_merge_but_attached_title_fragments_can():
    page = Page(pdf_paragraph=[paragraph('Left content', 40, region=1),
                              paragraph('Right content', 300, region=2)],
                page_layout=[PageLayout(id=1, box=Box(40, 50, 280, 700)),
                             PageLayout(id=2, box=Box(300, 50, 540, 700))])
    result = checked_rewrite(page, merge)
    assert result['reasons'] == ['cross_column_merge']
    page = Page(pdf_paragraph=[paragraph('Hamilton', 40, label='title'),
                              paragraph('ian Dynamics', 80, label='fallback_line')])
    assert checked_rewrite(page, merge)['accepted']
    assert len(page.pdf_paragraph) == 1


def test_exception_rolls_back_instead_of_leaving_partially_mutated_page():
    import pytest
    original = paragraph('Original content', 40)
    page = Page(pdf_paragraph=[original])
    def broken(target):
        chars(target.pdf_paragraph[0]).clear()
        raise RuntimeError('failed rewrite')
    with pytest.raises(RuntimeError, match='failed rewrite'):
        checked_rewrite(page, broken)
    assert page.pdf_paragraph[0] is original and len(chars(original)) == 16


def test_figure_fallback_text_is_preserved_once_but_caption_remains_translatable():
    label = paragraph('High Speed', 110, label='fallback_line')
    caption = paragraph('Fig. 1 example', 105, y=70, label='figure_caption')
    outside = paragraph('Nearby body', 40, label='fallback_line')
    page = Page(cropbox=Cropbox(box=Box(0, 0, 600, 800)),
                page_layout=[PageLayout(id=1, class_name='figure', box=Box(100, 90, 250, 200))],
                pdf_paragraph=[label, caption, outside])
    assert preserve_figure_text(page) == 1
    assert page.pdf_character == chars(label)
    assert page.pdf_paragraph == [caption, outside]
    assert preserve_figure_text(page) == 0
    assert page.pdf_character == chars(label)


def test_full_page_scan_and_partial_figure_overlap_do_not_suppress_text():
    label = paragraph('Selectable scan text', 110, label='fallback_line')
    page = Page(cropbox=Cropbox(box=Box(0, 0, 600, 800)),
                page_layout=[PageLayout(id=1, class_name='image', box=Box(0, 0, 600, 800))],
                pdf_paragraph=[label])
    assert preserve_figure_text(page) == 0 and page.pdf_paragraph == [label]
    page.page_layout = [PageLayout(id=1, class_name='figure', box=Box(100, 90, 150, 200))]
    assert preserve_figure_text(page) == 0 and page.pdf_paragraph == [label]
