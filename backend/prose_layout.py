"""Repair body words split by overlapping layout detector regions."""
import copy
import statistics


def join_fragmented_prose(page):
    from babeldoc.format.pdf.document_il.il_version_1 import PdfLine, PdfParagraphComposition
    from layout_preservation import characters, union_box
    from reference_layout import explicit_word_spaces

    paragraphs = page.pdf_paragraph
    candidates = []
    for i, p in enumerate(paragraphs):
        if p.layout_label not in ('plain text', 'title'):
            continue
        if p.layout_label == 'title' and len((p.unicode or '').strip()) > 3:
            continue
        if not p.pdf_paragraph_composition or not all(c.pdf_line for c in p.pdf_paragraph_composition):
            continue
        for comp in p.pdf_paragraph_composition:
            chars = [c for c in comp.pdf_line.pdf_character if (c.char_unicode or '').strip()]
            if not chars:
                continue
            chars.sort(key=lambda c: c.box.x)
            size = statistics.median(c.pdf_style.font_size for c in chars)
            candidates.append((i, comp.pdf_line, chars, size))
    parents = list(range(len(paragraphs)))
    def find(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i
    broken_words = []
    for n, (i, left, a, size) in enumerate(candidates):
        for j, right, b, other_size in candidates[n+1:]:
            if i == j or abs(size-other_size) > size*.08:
                continue
            # Compare text baselines using the glyph tops, not detector boxes.
            if abs(statistics.median(c.box.y2 for c in a)-statistics.median(c.box.y2 for c in b)) > size*.3:
                continue
            first, second = (a,b) if a[0].box.x < b[0].box.x else (b,a)
            tail, head = first[-1], second[0]
            gap = head.box.x-tail.box.x2
            if not (-size*.1 <= gap <= size*.6) or tail.pdf_style.font_id != head.pdf_style.font_id:
                continue
            parents[find(j)] = find(i)
            if gap < size*.18 and (tail.char_unicode or '').isalpha() and (head.char_unicode or '').isalpha():
                broken_words.append((i,j))
    groups = {}
    for i in range(len(paragraphs)):
        groups.setdefault(find(i), []).append(i)
    repaired = {}
    removed = set()
    for group in groups.values():
        if len(group)<2 or not any(i in group and j in group for i,j in broken_words):
            continue
        # A multiline body is evidence that these are word fragments, not
        # adjacent independent table cells or short labels on one baseline.
        if not any(len(paragraphs[i].pdf_paragraph_composition)>1 for i in group):
            continue
        owner = max(group, key=lambda i: len(list(characters(paragraphs[i]))))
        merged = copy.copy(paragraphs[owner])
        lines = []
        for i in group:
            for comp in paragraphs[i].pdf_paragraph_composition:
                line = comp.pdf_line
                size = statistics.median(c.pdf_style.font_size for c in line.pdf_character)
                top = statistics.median(c.box.y2 for c in line.pdf_character)
                row = next((r for r in lines if abs(r[0]-top)<size*.3), None)
                if row is None:
                    row=(top,[]);lines.append(row)
                row[1].extend(line.pdf_character)
        merged.pdf_paragraph_composition=[]
        text=[]
        for _, chars in sorted(lines,key=lambda row:-row[0]):
            chars=explicit_word_spaces(sorted(chars,key=lambda c:c.box.x),visual=True)
            merged.pdf_paragraph_composition.append(PdfParagraphComposition(pdf_line=PdfLine(box=union_box(chars),pdf_character=chars)))
            text.append(''.join(c.char_unicode or '' for c in chars))
        merged.unicode=' '.join(text)
        merged.box=union_box(list(characters(merged)))
        merged.layout_label='plain text'
        merged.render_order=min((paragraphs[i].render_order for i in group if paragraphs[i].render_order is not None),default=None)
        merged.debug_id=(merged.debug_id or '')+'-prose'
        repaired[min(group)]=merged;removed.update(group)
    page.pdf_paragraph=[repaired[i] if i in repaired else p for i,p in enumerate(paragraphs) if i not in removed or i in repaired]
