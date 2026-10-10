"""Render searchable scans without exposing their invisible OCR placeholder fonts.

The scan is the authority for figures and mathematical appearance. OCR text is
only used for translation and selection; no OCR model is loaded here.
"""
import copy
import re
import statistics


def is_searchable_scan(page):
    import pymupdf as fitz
    images = [fitz.Rect(item['bbox']) & page.rect for item in page.get_image_info()]
    if not images or max(rect.get_area() for rect in images) < page.rect.get_area() * .5:
        return False
    total = hidden = 0
    for span in page.get_texttrace():
        count = sum(chr(char[0]).isalnum() for char in span['chars'])
        total += count
        if span['type'] == 3 or span.get('opacity', 1) < .05:
            hidden += count
    return total >= 20 and hidden >= total * .7


def background_color(page):
    import pymupdf as fitz
    # Bounded thumbnail, sampled from paper rather than photographs or ink.
    pix = page.get_pixmap(matrix=fitz.Matrix(180 / max(page.rect.width, page.rect.height),
                                              180 / max(page.rect.width, page.rect.height)),
                          colorspace=fitz.csRGB, alpha=False, annots=False)
    data = pix.samples
    pixels = [data[i:i+3] for i in range(0, len(data), 3) if min(data[i:i+3]) >= 190]
    return tuple(statistics.median(p[c] for p in pixels) / 255 for c in range(3)) if pixels else (1, 1, 1)


def scan_profile(path):
    import pymupdf as fitz
    with fitz.open(path) as doc:
        # The application submits isolated pages. Never enable a document-wide
        # workaround on a mixed batch, where it would damage native PDF text.
        if len(doc) == 1 and is_searchable_scan(doc[0]):
            return {'background': background_color(doc[0]), 'paragraphs': {}}
    return None


def hide_character(char):
    from babeldoc.format.pdf.document_il.il_version_1 import GraphicState
    char.pdf_style = copy.copy(char.pdf_style)
    char.pdf_style.graphic_state = GraphicState(passthrough_per_char_instruction='3 Tr')


def raster_formula(formula, images):
    """Clip existing image resources and let normal formula relocation move them.

    Reusing the embedded images keeps their original resolution. The clipping
    path is expressed in image coordinates because FormRenderUnit applies that
    matrix before its graphic state. OCR glyphs remain selectable but invisible.
    """
    import pymupdf as fitz
    from babeldoc.format.pdf.document_il.il_version_1 import Box, GraphicState
    box = formula.box
    if not box or not formula.pdf_character:
        return
    clipped = []
    for image in images:
        matrix = image.pdf_matrix
        if not matrix or image.xobj_id != formula.pdf_character[0].xobj_id:
            continue
        inverse = ~fitz.Matrix(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
        if not any(inverse):
            continue
        points = [fitz.Point(x, y) * inverse for x, y in (
            (box.x-.3, box.y-.3), (box.x2+.3, box.y-.3),
            (box.x2+.3, box.y2+.3), (box.x-.3, box.y2+.3))]
        path = ' '.join(f'{p.x:.9f} {p.y:.9f} {"m" if i == 0 else "l"}' for i, p in enumerate(points))
        form = copy.copy(image)
        form.box = Box(box.x, box.y, box.x2, box.y2)
        state = image.graphic_state.passthrough_per_char_instruction or ''
        form.graphic_state = GraphicState(passthrough_per_char_instruction=f'{state} {path} h W n')
        form.render_order = None  # Above source images and text erasure masks.
        clipped.append(form)
    if clipped:
        formula.pdf_form = clipped
        formula.pdf_curve = []
        for char in formula.pdf_character:
            hide_character(char)


def inside_figure(paragraph, figures):
    b = paragraph.box
    if not b:
        return False
    area = max(.01, (b.x2-b.x)*(b.y2-b.y))
    return any(max(0, min(b.x2, f.x2)-max(b.x, f.x)) *
               max(0, min(b.y2, f.y2)-max(b.y, f.y)) > area * .5 for f in figures)


def subtract_boxes(box, protected):
    """Keep erasure masks out of nearby figures, equations and page numbers."""
    import pymupdf as fitz
    parts = [fitz.Rect(box.x-.8, box.y-.8, box.x2+.8, box.y2+.8)]
    for item in protected:
        cut = fitz.Rect(item.x-.3, item.y-.3, item.x2+.3, item.y2+.3)
        next_parts = []
        for part in parts:
            overlap = part & cut
            if overlap.is_empty:
                next_parts.append(part)
            else:
                next_parts.extend(rect for rect in (
                    fitz.Rect(part.x0, part.y0, part.x1, overlap.y0),
                    fitz.Rect(part.x0, overlap.y1, part.x1, part.y1),
                    fitz.Rect(part.x0, overlap.y0, overlap.x0, overlap.y1),
                    fitz.Rect(overlap.x1, overlap.y0, part.x1, overlap.y1)) if not rect.is_empty)
        parts = next_parts
    return parts


_installed = False


def install():
    global _installed
    if _installed:
        return
    from babeldoc.format.pdf.document_il.midend.paragraph_finder import ParagraphFinder
    from babeldoc.format.pdf.document_il.midend.styles_and_formulas import StylesAndFormulas
    from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting
    from babeldoc.format.pdf.document_il.il_version_1 import Box, GraphicState, PdfRectangle
    from layout_preservation import characters
    fill = ParagraphFinder.add_text_fill_background
    styles = StylesAndFormulas.process_page
    render = Typesetting.render_paragraph

    def fill_translated_only(self, page):
        if not getattr(self.translation_config, '_sandwich_scan', None):
            return fill(self, page)

    def preserve_scan(self, page):
        scan = getattr(self.translation_config, '_sandwich_scan', None)
        if not scan:
            return styles(self, page)
        figures = [layout.box for layout in page.page_layout if layout.class_name == 'figure' and layout.box]
        kept = []
        for paragraph in page.pdf_paragraph:
            if inside_figure(paragraph, figures):
                page.pdf_character.extend(characters(paragraph))
            else:
                kept.append(paragraph)
        page.pdf_paragraph = kept
        result = styles(self, page)
        scan['protected'] = [layout.box for layout in page.page_layout if layout.box and
                             layout.class_name in ('figure', 'table', 'isolate_formula', 'formula_caption')]
        scan['originalBoxes'] = {id(p): copy.copy(p.box) for p in page.pdf_paragraph if p.box}
        images = [form for form in page.pdf_form if form.form_type == 'image']
        scan['maskOrder'] = max((form.render_order or 0 for form in page.pdf_form), default=0)+1
        layouts = {layout.id: layout.box for layout in page.page_layout if layout.box}
        for paragraph in page.pdf_paragraph:
            if paragraph.box:
                box = copy.copy(paragraph.box)
                layout = layouts.get(paragraph.layout_id)
                # OCR glyph metrics can miss the rightmost letter/descenders.
                # The visual layout box includes that ink. Only use the whole
                # region when it belongs to this paragraph alone.
                if layout and sum(p.layout_id == paragraph.layout_id for p in page.pdf_paragraph) == 1:
                    box.x, box.y = min(box.x, layout.x), min(box.y, layout.y)
                    box.x2, box.y2 = max(box.x2, layout.x2), max(box.y2, layout.y2)
                scan['paragraphs'][id(paragraph)] = (paragraph.unicode, box)
            for comp in paragraph.pdf_paragraph_composition:
                if comp.pdf_formula:
                    raster_formula(comp.pdf_formula, images)
        for char in page.pdf_character:
            hide_character(char)
        return result

    def render_scan(self, paragraph, page, fonts):
        scan = getattr(self.translation_config, '_sandwich_scan', None)
        original = scan['paragraphs'].get(id(paragraph)) if scan else None
        if not original:
            return render(self, paragraph, page, fonts)
        source, box = original
        if paragraph.unicode == source or not re.search(r'[\u3400-\u9fff]', paragraph.unicode or ''):
            # Failed/skipped translations and page numbers retain scan pixels.
            # Do not paint placeholder fonts or blank out unchanged paragraphs.
            for char in characters(paragraph):
                hide_character(char)
            return
        result = render(self, paragraph, page, fonts)
        color = ' '.join(f'{v:.6f}' for v in scan['background'])
        protected = scan['protected'] + [b for key, b in scan['originalBoxes'].items() if key != id(paragraph)]
        for rect in subtract_boxes(box, protected):
            page.pdf_rectangle.append(PdfRectangle(
                box=Box(*rect),
                graphic_state=GraphicState(passthrough_per_char_instruction=f'{color} rg '),
                fill_background=True, debug_info=False, xobj_id=paragraph.xobj_id,
                render_order=scan['maskOrder'], line_width=0))
        return result

    ParagraphFinder.add_text_fill_background = fill_translated_only
    StylesAndFormulas.process_page = preserve_scan
    Typesetting.render_paragraph = render_scan
    _installed = True
