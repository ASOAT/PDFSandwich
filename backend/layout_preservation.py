"""Protect original PDF glyph geometry before BabelDOC translates prose.

Math uses the original glyphs and drawing paths. In ruled algorithms, keep math
at its original coordinates and translate the prose cells independently: a
fraction must never become several unrelated 'paragraphs'.
"""
import copy
import re
from collections import Counter

MATH_FONT = re.compile(r'(?:CMMI|CMSY|CMEX|MnSymbol|MSAM|MSBM|STIX.*Math|CambriaMath|LatinModernMath)', re.I)
ROMAN_MATH_FONT = re.compile(r'^(?:CMR|CMBX|CMSS)\d+$', re.I)
OPERATORS = r'exp|log|ln|sin|cos|tan|cot|sinh|cosh|tanh|lim|max|min|argmax|argmin|det|diag|tr|Pr|Var|Cov|rollout'
_installed = False


def characters(paragraph):
    for composition in paragraph.pdf_paragraph_composition:
        value = composition.pdf_line or composition.pdf_formula or composition.pdf_same_style_characters
        if value:
            yield from value.pdf_character
        elif composition.pdf_character:
            yield composition.pdf_character


def union_box(chars):
    from babeldoc.format.pdf.document_il.il_version_1 import Box
    boxes = [c.visual_bbox.box if c.visual_bbox else c.box for c in chars]
    return Box(min(b.x for b in boxes), min(b.y for b in boxes),
               max(b.x2 for b in boxes), max(b.y2 for b in boxes))


def math_fonts(page):
    fonts = {f.font_id: f.name.split('+')[-1] for f in page.pdf_font}
    hard = {key for key, name in fonts.items() if MATH_FONT.search(name)}
    roman = {key for key, name in fonts.items() if ROMAN_MATH_FONT.match(name)}
    # CMR is a prose font in many TeX documents. Only treat it as a math font
    # when another family clearly supplies this page's running text.
    counts = Counter(c.pdf_style.font_id for p in page.pdf_paragraph for c in characters(p)
                     if c.char_unicode and re.search('[A-Za-z]', c.char_unicode))
    total = sum(counts.values()) or 1
    if sum(counts[k] for k in roman) / total > .15:
        roman = set()
    return hard, roman


def expand_math(chars, flags, hard_fonts, roman_fonts):
    """Keep operator names and balanced delimiters inside their math atom."""
    flags = list(flags)
    text = ''.join(c.char_unicode or ' ' for c in chars)
    positions = []
    for i, char in enumerate(chars):
        positions.extend([i] * len(char.char_unicode or ' '))
        if char.pdf_style.font_id in hard_fonts | roman_fonts:
            flags[i] = True
    # Publishers often draw math letters with the prose font. Protect a short
    # letter group attached to a known accent/script (NO_theta, D_f), or enclosed
    # by recognized math. Otherwise it reaches translation as English "NO".
    # Explicit whitespace and full words are hard boundaries.
    i = 0
    while i < len(chars):
        if flags[i] or not (chars[i].char_unicode or '').isalpha():
            i += 1
            continue
        end = i+1
        while end < len(chars) and not flags[end] and (chars[end].char_unicode or '').isalpha():
            end += 1
        run = chars[i:end]
        if sum(len(c.char_unicode) for c in run) <= 2:
            attached = False
            for neighbor, base in ((i-1, run[0]), (end, run[-1])):
                if not 0 <= neighbor < len(chars) or not flags[neighbor]: continue
                other = chars[neighbor]
                if not (other.char_unicode or '').strip(): continue
                a = other.visual_bbox.box if other.visual_bbox else other.box
                b = base.visual_bbox.box if base.visual_bbox else base.box
                size = base.pdf_style.font_size
                gap = max(0, a.x-b.x2, b.x-a.x2)
                script = other.pdf_style.font_size < size*.87 and abs(a.y-b.y)<size*.8
                accent = a.y2-a.y<size*.4 and a.x<b.x2 and a.x2>b.x and 0<=a.y-b.y<size*1.3
                enclosed = i>0 and end<len(chars) and flags[i-1] and flags[end]
                if gap<size*.45 and (script or accent or enclosed): attached = True
            if attached: flags[i:end] = [True]*(end-i)
        i = end
    for match in re.finditer(r'\b(?:' + OPERATORS + r')\b', text):
        a, b = positions[match.start()], positions[match.end()-1]+1
        if any(flags[max(0, a-3):min(len(flags), b+3)]):
            flags[a:b] = [True] * (b-a)
    stack = []
    closing = {')': '(', ']': '[', '}': '{'}
    for i, char in enumerate(chars):
        value = char.char_unicode
        if value in ('(', '[', '{'):
            stack.append((value, i))
        elif value in closing and stack and stack[-1][0] == closing[value]:
            _, start = stack.pop()
            # Parenthesized prose, acronyms and citations with author names
            # remain prose; a balanced mathematical group is indivisible.
            # Consecutive math letters (e.g. x followed by subscript t) are
            # variables, not an English word that should leave its brackets out.
            prose = ''.join((c.char_unicode or ' ') if not flags[j] else ' '
                            for j,c in enumerate(chars[start+1:i],start+1))
            words = re.findall(r'[A-Za-z]{2,}', prose)
            if any(flags[start+1:i]) and all(re.fullmatch(OPERATORS, w) for w in words):
                flags[start:i+1] = [True] * (i-start+1)
    # Preserve intervening whitespace inside the same formula, but never join
    # two source lines (this function is called on one PdfLine at a time).
    for i in range(1, len(chars)-1):
        if (chars[i].char_unicode or ' ').isspace() and flags[i-1] and flags[i+1]:
            flags[i] = True
    return flags


def protect_heading_number(page):
    from babeldoc.format.pdf.document_il.utils.layout_helper import get_char_unicode_string
    for paragraph in page.pdf_paragraph:
        match = re.match(r'^\s*(\d+(?:\.\d+)*\.?|[IVXLCDM]+)\s+[A-Za-z]', paragraph.unicode or '')
        if paragraph.layout_label != 'title' or not match:
            continue
        compositions = paragraph.pdf_paragraph_composition
        if not compositions or not compositions[0].pdf_line:
            continue
        line = compositions[0].pdf_line
        chars = line.pdf_character
        end = 0
        prefix = ''
        while end < len(chars) and len(prefix.strip()) < len(match[1]):
            prefix += chars[end].char_unicode or ' '
            end += 1
        while end < len(chars) and (chars[end].char_unicode or ' ').isspace():
            end += 1
        if not end or end == len(chars):
            continue
        page.pdf_character.extend(chars[:end])
        line.pdf_character = chars[end:]
        line.box = union_box(line.pdf_character)
        remaining = list(characters(paragraph))
        paragraph.box = union_box(remaining)
        paragraph.unicode = get_char_unicode_string(remaining)
        paragraph.first_line_indent = False


def algorithm_regions(page):
    """Require an Algorithm caption and matching horizontal enclosure rules."""
    rules = [c.box for c in page.pdf_curve if c.box and c.box.x2-c.box.x > 100
             and c.box.y2-c.box.y < 1]
    result = []
    for paragraph in page.pdf_paragraph:
        if not re.match(r'^Algorithm\s+\d+\b', paragraph.unicode or '', re.I):
            continue
        b = paragraph.box
        matching = [r for r in rules if abs(r.x-b.x) < 8 and r.x2 >= b.x2-5]
        header = [r for r in matching if b.y-8 <= r.y <= b.y+2]
        if not header:
            continue
        top = max(header, key=lambda r: r.y)
        bottom = [r for r in matching if top.y-450 < r.y < top.y-15]
        if bottom:
            result.append((top.x, max(r.y for r in bottom), top.x2, top.y))
    return result


def preserve_algorithms(page, hard_fonts, roman_fonts):
    from babeldoc.format.pdf.document_il.il_version_1 import PdfLine, PdfParagraphComposition
    from babeldoc.format.pdf.document_il.utils.layout_helper import get_char_unicode_string
    regions = algorithm_regions(page)
    if not regions:
        return
    result = []
    for paragraph in page.pdf_paragraph:
        b = paragraph.box
        if not any(x-2 <= b.x and b.x2 <= right+2 and bottom <= b.y and b.y2 <= top+2
                   for x, bottom, right, top in regions):
            result.append(paragraph)
            continue
        # A layout detector can merge all algorithm rows into one paragraph,
        # or split a single fraction into several paragraphs. Neither grouping
        # should be allowed to reposition mathematical glyphs.
        chars = list(characters(paragraph))
        math = expand_math(chars, [bool(c.formula_layout_id) or bool(re.fullmatch(r'\d+', c.char_unicode or '')) for c in chars], hard_fonts, roman_fonts)
        run = []

        def flush():
            nonlocal run
            if not run:
                return
            value = get_char_unicode_string(run).strip()
            if not re.search(r'[A-Za-z]{2}', value):
                page.pdf_character.extend(run)
            else:
                p = copy.copy(paragraph)
                p.render_order = min((c.render_order for c in run if c.render_order is not None),default=None)
                p.box = union_box(run)
                # Retain the source baseline/line height for a short prose cell.
                p.box.y = min(p.box.y, min(c.box.y for c in run)-2)
                p.box.y2 = max(p.box.y2, max(c.box.y+c.pdf_style.font_size for c in run))
                p.pdf_paragraph_composition = [PdfParagraphComposition(pdf_line=PdfLine(box=copy.copy(p.box), pdf_character=run))]
                p.unicode = value
                p.first_line_indent = False
                p.debug_id = (paragraph.debug_id or '') + f'-cell-{len(result)}'
                result.append(p)
            run = []

        for i, char in enumerate(chars):
            # Line numbers and single mathematical constants never go to the
            # translator. Prose cells keep source bold/italic/color metadata.
            frozen = math[i] or bool(re.fullmatch(r'[\d:]+', char.char_unicode or ''))
            if frozen:
                flush()
                page.pdf_character.append(char)
            else:
                if run and (abs(char.box.y-run[-1].box.y) > char.pdf_style.font_size*.6
                            or char.box.x < run[-1].box.x-1):
                    flush()
                run.append(char)
        flush()
    page.pdf_paragraph = result


def install():
    global _installed
    if _installed:
        return
    from babeldoc.format.pdf.document_il.midend.styles_and_formulas import StylesAndFormulas
    original_page = StylesAndFormulas.process_page
    original_classify = StylesAndFormulas._classify_characters_in_composition
    original_merge = StylesAndFormulas.merge_overlapping_formulas

    def process_page(self, page):
        self._sandwich_fonts = math_fonts(page)
        self._sandwich_formula_id = -10000
        from reference_layout import split_references
        from layout_atoms import split_numbered_lists
        from prose_layout import join_fragmented_prose, join_fragmented_titles, preserve_author_rows
        join_fragmented_titles(page)
        join_fragmented_prose(page)
        preserve_author_rows(page)
        split_references(page)
        split_numbered_lists(page)
        preserve_algorithms(page, *self._sandwich_fonts)
        protect_heading_number(page)
        return original_page(self, page)

    def merge(self, page):
        original_merge(self, page)
        from layout_atoms import join_formula_atoms
        join_formula_atoms(page)

    def classify(self, composition, formula_font_ids, first_is_bullet_so_far, line_index):
        tagged, bullet = original_classify(self, composition, formula_font_ids, first_is_bullet_so_far, line_index)
        if not tagged:
            return tagged, bullet
        chars = [x[0] for x in tagged]
        flags = expand_math(chars, [x[1] for x in tagged], *self._sandwich_fonts)
        result = []
        in_formula = False
        protected = set()
        start = 0
        while start < len(chars):
            end = start+1
            while end < len(chars) and flags[end] == flags[start]:
                end += 1
            value = ''.join(c.char_unicode or ' ' for c in chars[start:end])
            if flags[start] and not re.fullmatch(r'[\d\s.,]+', value):
                protected.update(range(start, end))
            start = end
        for index, ((char, _, corner), flag) in enumerate(zip(tagged, flags)):
            if flag:
                if not in_formula:
                    self._sandwich_formula_id -= 1
                # Upstream respects explicitly identified formulas: no comma
                # splitting and no converting numerals back to translatable text.
                if index in protected:
                    char.formula_layout_id = char.formula_layout_id or self._sandwich_formula_id
            result.append((char, flag, corner))
            in_formula = flag
        return result, bullet

    StylesAndFormulas.process_page = process_page
    StylesAndFormulas.merge_overlapping_formulas = merge
    StylesAndFormulas._classify_characters_in_composition = classify
    _installed = True
