"""Recover numbered bibliography entries from glyph coordinates, not ML boxes."""
import copy
import re


def explicit_word_spaces(chars):
    """PDF text often encodes word spaces only as a glyph-position gap.

    Upstream infers spaces from a paragraph-wide distance statistic; justified
    reference lines have different spacing, so that loses names on tight lines.
    Make line-local gaps explicit before styles split the text into runs.
    """
    from babeldoc.format.pdf.document_il.il_version_1 import Box, VisualBbox
    result = []
    for char in chars:
        if result:
            prev = result[-1]
            gap = char.box.x-prev.box.x2
            size = min(prev.pdf_style.font_size, char.pdf_style.font_size)
            if (gap > size*.16 and (prev.char_unicode or '').strip()
                    and (char.char_unicode or '').strip()):
                space = copy.copy(prev)
                space.char_unicode = ' '
                space.pdf_character_id = None
                space.box = Box(prev.box.x2, prev.box.y, char.box.x, prev.box.y2)
                space.visual_bbox = VisualBbox(box=space.box)
                result.append(space)
        result.append(char)
    return result


def split_references(page):
    from layout_preservation import characters, union_box
    from babeldoc.format.pdf.document_il.il_version_1 import PdfParagraph, PdfLine, PdfParagraphComposition
    from babeldoc.format.pdf.document_il.utils.layout_helper import get_char_unicode_string
    all_chars = list(page.pdf_character) + [c for p in page.pdf_paragraph for c in characters(p)]
    # References use normal body baselines. Fold nearby superscripts into their
    # line after the numbered margin has identified the bibliography column.
    rows = []
    for char in sorted(all_chars, key=lambda c: (-c.box.y, c.box.x)):
        if not rows or abs(rows[-1][0]-char.box.y) > 1.5:
            rows.append((char.box.y, []))
        rows[-1][1].append(char)
    markers = []
    for y, chars in rows:
        chars.sort(key=lambda c: c.box.x)
        text = get_char_unicode_string(chars)
        match = re.match(r'^\s*\[(\d{1,4})\]', text)
        if match:
            end = next((i+1 for i, c in enumerate(chars) if c.char_unicode == ']'), 0)
            if end:
                markers.append((int(match[1]), y, chars[:end]))
        # The second column can have a marker in the middle of the glyph row.
        for i, char in enumerate(chars[1:], 1):
            if char.char_unicode != '[' or char.box.x-chars[i-1].box.x2 < 18:
                continue
            tail = chars[i:]
            match = re.match(r'^\[(\d{1,4})\]', get_char_unicode_string(tail))
            if match:
                end = next((j+1 for j, c in enumerate(tail) if c.char_unicode == ']'), 0)
                markers.append((int(match[1]), y, tail[:end]))
    columns = []
    for marker in markers:
        right = marker[2][-1].box.x2
        column = next((col for col in columns if abs(col[0][2][-1].box.x2-right) < 6), None)
        if column is None:
            columns.append([marker])
        else:
            column.append(marker)
    columns = [sorted(col, key=lambda m: -m[1]) for col in columns if len(col) >= 3]
    columns = [col for col in columns if all(a[0] < b[0] for a, b in zip(col, col[1:]))]
    if not columns:
        return
    columns.sort(key=lambda col: col[0][2][0].box.x)
    consumed = set()
    entries = []
    for column_index, column in enumerate(columns):
        left = min(c.box.x for _, _, cs in column for c in cs)-1
        right = min(c.box.x for _, _, cs in columns[column_index+1] for c in cs)-12 if column_index+1 < len(columns) else page.cropbox.box.x2
        column_entries = []
        for index, (_, baseline, label) in enumerate(column):
            size = label[0].pdf_style.font_size
            lower = column[index+1][1]+size*.65 if index+1 < len(column) else baseline-size*8
            candidates = [c for c in all_chars if left <= c.box.x < right and lower < c.box.y <= baseline+size*.65]
            # Do not absorb a page footer or following section into the last entry.
            if index+1 == len(column):
                baselines = sorted({round(c.box.y, 1) for c in candidates}, reverse=True)
                limit = baseline
                for y in baselines:
                    if limit-y > size*1.8:
                        break
                    limit = y
                candidates = [c for c in candidates if c.box.y >= limit-.2]
            line_rows = []
            for c in sorted(candidates, key=lambda c: (-c.box.y, c.box.x)):
                if not line_rows or abs(line_rows[-1][0]-c.box.y) > size*.4:
                    line_rows.append((c.box.y, []))
                line_rows[-1][1].append(c)
            label_ids = {id(c) for c in label}
            lines = []
            for _, chars in line_rows:
                chars = sorted([c for c in chars if id(c) not in label_ids], key=lambda c: c.box.x)
                while chars and not (chars[0].char_unicode or '').strip():
                    chars.pop(0)
                if chars:
                    chars = explicit_word_spaces(chars)
                    lines.append(PdfParagraphComposition(pdf_line=PdfLine(box=union_box(chars), pdf_character=chars)))
            if not lines:
                continue
            body = [c for line in lines for c in line.pdf_line.pdf_character]
            entry = PdfParagraph(box=union_box(body), pdf_style=copy.copy(body[0].pdf_style),
                                 pdf_paragraph_composition=lines, xobj_id=body[0].xobj_id,
                                 unicode=get_char_unicode_string(body), first_line_indent=False,
                                 layout_label='reference', debug_id=f'reference-{column_index}-{index}')
            column_entries.append(entry)
            consumed.update(id(c) for c in candidates)
            entries.append((entry, label))
        if column_entries:
            width = max(p.box.x2 for p in column_entries)
            for p in column_entries:
                p.box.x2 = width
    if not consumed:
        return
    # Remove every consumed glyph from its old container, including fragments
    # that the layout detector placed in separate paragraphs midway through a word.
    page.pdf_character = [c for c in page.pdf_character if id(c) not in consumed]
    remaining = []
    for p in page.pdf_paragraph:
        compositions = []
        for comp in p.pdf_paragraph_composition:
            if comp.pdf_line:
                comp.pdf_line.pdf_character = [c for c in comp.pdf_line.pdf_character if id(c) not in consumed]
                if comp.pdf_line.pdf_character:
                    compositions.append(comp)
            else:
                compositions.append(comp)
        p.pdf_paragraph_composition = compositions
        if list(characters(p)):
            remaining.append(p)
    for entry, label in entries:
        remaining.append(entry)
        page.pdf_character.extend(label)
    page.pdf_paragraph = remaining
