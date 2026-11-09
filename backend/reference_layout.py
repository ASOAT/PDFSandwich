"""Recover numbered bibliography entries from glyph coordinates, not ML boxes."""
import copy
import re
from dataclasses import dataclass


_REFERENCE_SOURCE_LABELS = {'plain text', 'text', 'paragraph', 'paragraph_hybrid',
                            'reference', 'reference_content', 'reference_hybrid',
                            'fallback_line', 'tiny text'}


@dataclass
class _SourceLine:
    chars: list
    owner: object

    @property
    def visible(self):
        return [c for c in self.chars if (c.char_unicode or '').strip()]


def _reference_lines(page):
    """Keep source line ownership: a citation inside prose is never an entry.

    Detector paragraphs can span several bibliography entries or columns, but
    their physical lines still provide the boundary that a page-wide glyph
    search loses. Excluded roles remain barriers, not candidate text.
    """
    lines = []
    for paragraph in page.pdf_paragraph:
        for comp in paragraph.pdf_paragraph_composition:
            if comp.pdf_line:
                lines.append(_SourceLine(sorted(comp.pdf_line.pdf_character,
                                                key=lambda c: c.box.x), paragraph))
    # Standalone labels can survive an earlier classifier outside paragraphs.
    loose = {}
    for char in page.pdf_character:
        key = (char.xobj_id, round(char.box.y / 1.5))
        loose.setdefault(key, []).append(char)
    lines.extend(_SourceLine(sorted(chars, key=lambda c: c.box.x), None)
                 for chars in loose.values())
    return lines


def _line_markers(lines):
    markers = []
    for line in lines:
        if line.owner is not None and line.owner.layout_label not in _REFERENCE_SOURCE_LABELS:
            continue
        chars = line.visible
        if not chars or chars[0].char_unicode != '[':
            continue
        label = [chars[0]]
        size = chars[0].pdf_style.font_size
        for char in chars[1:6]:
            if char.box.x-label[-1].box.x2 > size*.7:
                break
            label.append(char)
            if char.char_unicode == ']':
                break
        match = re.fullmatch(r'\[(\d{1,4})\]', ''.join(c.char_unicode or '' for c in label))
        if not match:
            continue
        head = label[0]
        # A separate detector fragment can start with an inline citation. Check
        # adjacent source lines too, without confusing the neighboring column.
        preceded = any(c.box.x2 <= head.box.x and head.box.x-c.box.x2 < size*.7
                       and abs(c.box.y-head.box.y) < size*.3
                       and c.xobj_id == head.xobj_id
                       for other in lines if other is not line for c in other.visible)
        if not preceded:
            markers.append((int(match[1]), head.box.y, label, line))
    return markers


def explicit_word_spaces(chars, visual=False):
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
            current_box=char.visual_bbox.box if visual and char.visual_bbox else char.box
            previous_box=prev.visual_bbox.box if visual and prev.visual_bbox else prev.box
            gap = current_box.x-previous_box.x2
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
    if not page.cropbox:
        return
    source_lines = _reference_lines(page)
    source_ids = [id(c) for line in source_lines for c in line.chars]
    if len(source_ids) != len(set(source_ids)):
        return  # Ownership is already ambiguous; do not amplify it.
    markers = _line_markers(source_lines)
    columns = []
    for marker in markers:
        right = marker[2][-1].box.x2
        column = next((col for col in columns if
                       col[0][2][0].xobj_id == marker[2][0].xobj_id and
                       abs(col[0][2][-1].box.x2-right) < 6), None)
        if column is None:
            columns.append([marker])
        else:
            column.append(marker)
    columns = [sorted(col, key=lambda m: -m[1]) for col in columns if len(col) >= 3]
    # A bibliography enumerates successive entries; increasing scattered
    # citation numbers are not evidence of a bibliography region.
    columns = [col for col in columns if all(a[0]+1 == b[0] for a, b in zip(col, col[1:]))]
    if not columns:
        return
    columns.sort(key=lambda col: col[0][2][0].box.x)
    # Plan complete line transfers first. Never crop arbitrary right-hand
    # pieces out of body text, captions, or equations to manufacture an entry.
    consumed = set()
    entries = []
    for column_index, column in enumerate(columns):
        left = min(c.box.x for _, _, cs, _ in column for c in cs)-1
        right = min(c.box.x for _, _, cs, _ in columns[column_index+1] for c in cs)-1 if column_index+1 < len(columns) else page.cropbox.box.x2
        xobj_id = column[0][2][0].xobj_id
        column_entries = []
        for index, (_, baseline, label, _) in enumerate(column):
            size = label[0].pdf_style.font_size
            lower = column[index+1][1]+size*.65 if index+1 < len(column) else baseline-size*8
            selected = []
            for source_line in source_lines:
                if source_line.owner is not None and source_line.owner.layout_label not in _REFERENCE_SOURCE_LABELS:
                    continue
                visible = source_line.visible
                if not visible or any(c.xobj_id != xobj_id for c in visible):
                    continue
                if min(c.box.x for c in visible) < left or max(c.box.x2 for c in visible) > right:
                    continue
                # Superscripts remain attached to their physical source line.
                baseline_chars = [c for c in visible if c.pdf_style.font_size >= size*.8]
                if not baseline_chars:
                    continue
                y = min(c.box.y for c in baseline_chars)
                if lower < y <= baseline+size*.65:
                    selected.append(source_line)
            candidates = [c for source_line in selected for c in source_line.chars]
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
            if any(id(c) in consumed for c in candidates):
                # Ambiguous ownership leaves the page unchanged instead of
                # rendering one glyph in more than one translated region.
                return
            body = [c for line in lines for c in line.pdf_line.pdf_character]
            entry = PdfParagraph(box=union_box(body), pdf_style=copy.copy(body[0].pdf_style),
                                 pdf_paragraph_composition=lines, xobj_id=body[0].xobj_id,
                                 unicode=get_char_unicode_string(body), first_line_indent=False,
                                 render_order=min((c.render_order for c in body if c.render_order is not None),default=None),
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
    # Commit the verified transfer. Recompute surviving geometry/text as well:
    # stale bounds would otherwise remain an invisible obstruction to typesetting.
    page.pdf_character = [c for c in page.pdf_character if id(c) not in consumed]
    remaining = []
    for p in page.pdf_paragraph:
        compositions = []
        for comp in p.pdf_paragraph_composition:
            if comp.pdf_line:
                comp.pdf_line.pdf_character = [c for c in comp.pdf_line.pdf_character if id(c) not in consumed]
                if comp.pdf_line.pdf_character:
                    comp.pdf_line.box = union_box(comp.pdf_line.pdf_character)
                    compositions.append(comp)
            else:
                compositions.append(comp)
        p.pdf_paragraph_composition = compositions
        if list(characters(p)):
            if any(id(c) in consumed for line in source_lines if line.owner is p for c in line.chars):
                p.box = union_box(list(characters(p)))
                p.unicode = get_char_unicode_string(list(characters(p)))
            remaining.append(p)
    for entry, label in entries:
        remaining.append(entry)
        page.pdf_character.extend(label)
    page.pdf_paragraph = remaining
