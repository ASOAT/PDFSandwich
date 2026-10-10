"""Reuse immutable layout resources inside our already isolated page worker.

The application translates one page at a time. Its worker has cancellation and
a process deadline, so spawning another Python interpreter to subset/save that
single page only duplicates imports and disk I/O (particularly on Windows).
"""
import copy
import functools
import threading

_installed = False


class LayoutTranslator:
    name = 'pdfsandwich-v12'
    preserves_styles = True
    model = 'guarded-text'
    lang_in = 'en'
    lang_out = 'zh'

    def __init__(self, engine):
        from babeldoc.translator.translator import RateLimiter
        self.engine = engine
        self.limiter = RateLimiter(100 if engine.local is not None else 2)

    def translate(self, text, ignore_cache=False, rate_limit_params=None):
        self.limiter.wait()
        return self.engine.translate(text)

    def do_llm_translate(self, *args, **kwargs):
        raise NotImplementedError

    def get_formular_placeholder(self, identifier):
        return '{v'+str(identifier)+'}', rf'{{\s*v\s*{identifier}\s*}}'

    def get_rich_text_left_placeholder(self, identifier):
        return f"<style id='{identifier}'>", rf"<\s*style\s*id\s*=\s*'\s*{identifier}\s*'\s*>"

    def get_rich_text_right_placeholder(self, identifier):
        return '</style>', r'<\s*/\s*style\s*>'


def install():
    global _installed
    if _installed:
        return
    from layout_preservation import install as install_preservation
    install_preservation()
    from babeldoc.format.pdf.document_il.utils.fontmap import FontMapper
    from babeldoc.format.pdf.document_il.backend.pdf_creater import PDFCreater
    from babeldoc.docvision.base_doclayout import DocLayoutModel
    from babeldoc.format.pdf.document_il.midend.il_translator import ILTranslator
    DocLayoutModel.load_available = staticmethod(functools.cache(DocLayoutModel.load_available))
    prepare = ILTranslator.pre_translate_paragraph
    translate_page = ILTranslator.process_page

    def translate_page_with_context(self, page, *args, **kwargs):
        from translation_context import contexts_for_page
        engine=getattr(self.translate_engine,'engine',None)
        self.translation_config._sandwich_contexts=contexts_for_page(page,getattr(engine,'page_context',{}))
        return translate_page(self,page,*args,**kwargs)

    ILTranslator.process_page = translate_page_with_context

    def prepare_styled(self, paragraph, tracker, page_font_map, xobj_font_map):
        if getattr(self.translate_engine, 'preserves_styles', False):
            # Upstream assumes only its LLM prompt path can preserve styles.
            # Our TextEngine handles tags itself. Use a per-call proxy to
            # enable style extraction without racing other paragraph workers
            # or opting into upstream LLM prompts.
            proxy = copy.copy(self)
            proxy.support_llm_translate = True
            text, translation_input = prepare(proxy, paragraph, tracker, page_font_map, xobj_font_map)
            if text and paragraph.layout_label == 'reference':
                text = '\x1ereference\x1f' + text
            if text:
                from translation_context import envelope
                text=envelope(text,getattr(self.translation_config,'_sandwich_contexts',{}).get(id(paragraph)))
            return text, translation_input
        return prepare(self, paragraph, tracker, page_font_map, xobj_font_map)

    ILTranslator.pre_translate_paragraph = prepare_styled
    from babeldoc.format.pdf.document_il.midend.typesetting import Typesetting, TypesettingUnit
    relocate_unit = TypesettingUnit.relocate
    update_order = Typesetting._update_paragraph_render_order
    render_paragraph = Typesetting.render_paragraph
    paint_context = threading.local()

    def render_badge_paragraph(self, *args, **kwargs):
        previous = getattr(paint_context, 'backgrounds', None)
        paint_context.backgrounds = {}
        try:
            return render_paragraph(self, *args, **kwargs)
        finally:
            paint_context.backgrounds = previous

    def relocate_badges(self, *args, **kwargs):
        relocated = relocate_unit(self, *args, **kwargs)
        backgrounds = getattr(paint_context, 'backgrounds', None)
        if backgrounds is not None and self.formular and relocated.formular:
            for source, target in zip(self.formular.pdf_character, relocated.formular.pdf_character):
                if source.formula_layout_id is not None and source.formula_layout_id <= -300000:
                    # Upstream rebuilds glyphs during relocation, then resets
                    # their order to the paragraph's. Keep the background linked
                    # until that reset, so it cannot cover the white digit.
                    backgrounds[id(target)] = relocated.formular.pdf_curve
                    break
        return relocated

    def update_badge_order(self, paragraph):
        update_order(self, paragraph)
        for comp in paragraph.pdf_paragraph_composition:
            char = comp.pdf_character
            if char and char.render_order is not None and char.sub_render_order is not None:
                for curve in (getattr(paint_context, 'backgrounds', None) or {}).get(id(char), []):
                    # Curves have only a main drawing order in the pinned IL.
                    # Draw the background just before this paragraph's glyphs.
                    curve.render_order = char.render_order - 1

    TypesettingUnit.relocate = relocate_badges
    Typesetting._update_paragraph_render_order = update_badge_order
    Typesetting.render_paragraph = render_badge_paragraph
    word_width = Typesetting._get_width_before_next_break_point

    def remaining_word_width(self, units, scale):
        # The caller already adds the current glyph's width. Upstream counts
        # it twice, which can fit the first letter then break inside the word
        # when the second glyph is wider (e.g. "a" / "nd" in a reference).
        width = word_width(self, units, scale)
        return max(0, width-units[0].width*scale) if units else 0

    Typesetting._get_width_before_next_break_point = remaining_word_width
    render_unit = TypesettingUnit.render

    def render_styled(self):
        result = render_unit(self)
        if (not self.can_passthrough and self.unicode and self.original_font
                and self.original_font.italic and self.font and not self.font.is_italic):
            # CJK font packs often have no oblique face. Preserve italic text
            # with a 12-degree shear around each glyph's original baseline.
            for char in result[0]:
                char.pdf_style = copy.copy(char.pdf_style)
                char.pdf_style.graphic_state = copy.copy(char.pdf_style.graphic_state)
                state = char.pdf_style.graphic_state
                state.passthrough_per_char_instruction = str(state.passthrough_per_char_instruction or '') + f' 1 0 0.212557 1 {-0.212557*char.box.y:.6f} 0 cm'
        return result

    TypesettingUnit.render = render_styled

    initialize = FontMapper.__init__
    templates = {}
    lock = threading.Lock()

    def initialize_cached(self, config):
        key = (config.lang_out, config.primary_font_family)
        with lock:
            if key not in templates:
                initialize(self, config)
                # Do not retain configuration / document data or bound methods.
                templates[key] = {k: v for k, v in vars(self).items()
                                  if k not in ('translation_config', 'has_char', 'map_in_type')}
                return
            for name, value in templates[key].items():
                setattr(self, name, copy.copy(value) if isinstance(value, (dict, list)) else value)
        self.translation_config = config
        self.has_char = functools.lru_cache(maxsize=10240, typed=True)(self.has_char)
        self.map_in_type = functools.lru_cache(maxsize=10240, typed=True)(self.map_in_type)

    subset_original = PDFCreater.subset_fonts_in_subprocess
    save_original = PDFCreater.save_pdf_with_timeout

    def subset(pdf, config, tag):
        if len(pdf) != 1:
            return subset_original(pdf, config, tag)
        config.raise_if_cancelled()
        pdf.subset_fonts(fallback=False)
        return pdf

    def save(pdf, output_path, translation_config, garbage=1, deflate=True,
             clean=True, deflate_fonts=True, linear=False, timeout=120, tag=''):
        if len(pdf) != 1:
            return save_original(pdf, output_path, translation_config, garbage,
                                 deflate, clean, deflate_fonts, linear, timeout, tag)
        translation_config.raise_if_cancelled()
        pdf.save(output_path, garbage=garbage, deflate=deflate, clean=clean,
                 deflate_fonts=deflate_fonts, linear=linear)
        return True

    FontMapper.__init__ = initialize_cached
    PDFCreater.subset_fonts_in_subprocess = staticmethod(subset)
    PDFCreater.save_pdf_with_timeout = staticmethod(save)
    _installed = True
