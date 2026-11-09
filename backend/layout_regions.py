"""Contracts for geometry-preserving rewrites before formula classification.

Rewriters may repartition glyphs, but cannot duplicate/drop visible glyphs or
join independent columns/roles. Work on copied containers, never deepcopy the
native parser's lazy graphics-state chains. This is deliberately not a new
layout detector: source glyphs and the existing detector remain authoritative.
"""
import copy
from collections import Counter
from itertools import combinations
from statistics import median


def _characters(paragraph):
    from layout_preservation import characters
    return list(characters(paragraph))


def _visible(chars):
    return [c for c in chars if (c.char_unicode or '').strip()]


def _all_visible(page):
    return _visible([*page.pdf_character,
                     *(c for p in page.pdf_paragraph for c in _characters(p))])


def _clone_paragraph(paragraph):
    result = copy.copy(paragraph)
    result.box = copy.copy(paragraph.box)
    result.pdf_paragraph_composition = []
    for original in paragraph.pdf_paragraph_composition:
        comp = copy.copy(original)
        for key in ('pdf_line', 'pdf_formula', 'pdf_same_style_characters'):
            value = getattr(original, key)
            if value is not None:
                clone = copy.copy(value)
                clone.box = copy.copy(value.box)
                clone.pdf_character = list(value.pdf_character)
                setattr(comp, key, clone)
        result.pdf_paragraph_composition.append(comp)
    return result


def _role(label):
    if label in ('figure_caption', 'table_caption', 'figure_title', 'chart_title'):
        return 'caption'
    if label in ('plain text', 'text', 'content', 'paragraph'):
        return 'body'
    return None


def _separate_columns(a, b, size):
    if a is None or b is None:
        return False
    # Short fragments and margin labels are not evidence of separate columns.
    return (min(a.x2-a.x, b.x2-b.x) >= 4*size
            and max(a.x-b.x2, b.x-a.x2) > .65*size)


def checked_rewrite(page, rewrite):
    """Apply a pre-style rewrite transactionally; return a compact audit record.

    Synthetic whitespace is allowed. Original visible glyph objects must occur
    the same number of times afterwards. A failed contract restores the exact
    input containers; unexpected programming exceptions also restore then raise.
    Store the returned record on TranslationConfig, not Page (a slotted IL).
    """
    original_paragraphs, original_loose = page.pdf_paragraph, page.pdf_character
    before = Counter(id(c) for c in _all_visible(page))
    layouts = {layout.id: layout.box for layout in page.page_layout}
    owners, regions = {}, {}
    for index, paragraph in enumerate(original_paragraphs):
        chars = _visible(_characters(paragraph))
        for char in chars:
            owners[id(char)] = index
        regions[index] = (paragraph, layouts.get(paragraph.layout_id, paragraph.box),
                          median(c.pdf_style.font_size for c in chars) if chars else 10)
    page.pdf_paragraph = [_clone_paragraph(p) for p in original_paragraphs]
    page.pdf_character = list(original_loose)
    try:
        rewrite(page)
        after = Counter(id(c) for c in _all_visible(page))
        missing = sum((before-after).values())
        added = sum((after-before).values())
        reasons = []
        if missing:
            reasons.append('lost_glyphs')
        if added:
            reasons.append('added_or_duplicate_glyphs')
        mixed_roles = cross_columns = 0
        for paragraph in page.pdf_paragraph:
            sources = {owners[id(c)] for c in _visible(_characters(paragraph)) if id(c) in owners}
            if len(sources) < 2:
                continue
            roles = {_role(regions[i][0].layout_label) for i in sources} - {None}
            if len(roles) > 1:
                mixed_roles += 1
            for i, j in combinations(sources, 2):
                a, abox, asize = regions[i]
                b, bbox, bsize = regions[j]
                if a.xobj_id == b.xobj_id and _separate_columns(abox, bbox, min(asize, bsize)):
                    cross_columns += 1
                    break
        if mixed_roles:
            reasons.append('mixed_body_and_caption')
        if cross_columns:
            reasons.append('cross_column_merge')
        accepted = not reasons
        if not accepted:
            page.pdf_paragraph, page.pdf_character = original_paragraphs, original_loose
        return {'rewrite': rewrite.__name__, 'accepted': accepted, 'reasons': reasons,
                'lostGlyphs': missing, 'addedGlyphs': added,
                'mixedRoleParagraphs': mixed_roles, 'crossColumnParagraphs': cross_columns}
    except Exception:
        page.pdf_paragraph, page.pdf_character = original_paragraphs, original_loose
        raise


def preserve_figure_text(page):
    """Keep figure-internal fallback text in the original drawing layer.

    Figure captions remain translatable. A full-page scan image is a background,
    not an illustration: it must not suppress its searchable text layer.
    """
    if not page.cropbox:
        return 0
    crop = page.cropbox.box
    page_area = (crop.x2-crop.x)*(crop.y2-crop.y)
    if page_area <= 0:
        return 0
    figures = [layout.box for layout in page.page_layout
               if layout.class_name in ('figure', 'image') and layout.box is not None
               and 0 < (layout.box.x2-layout.box.x)*(layout.box.y2-layout.box.y) < .9*page_area]
    remaining, count = [], 0
    for paragraph in page.pdf_paragraph:
        chars = _characters(paragraph)
        visible = _visible(chars)
        def contains(box, char):
            b = char.visual_bbox.box if char.visual_bbox else char.box
            return box.x-1 <= b.x and box.y-1 <= b.y and b.x2 <= box.x2+1 and b.y2 <= box.y2+1
        if (paragraph.layout_label == 'fallback_line' and visible
                and any(all(contains(box, c) for c in visible) for box in figures)):
            page.pdf_character.extend(chars)
            count += 1
        else:
            remaining.append(paragraph)
    page.pdf_paragraph = remaining
    return count
