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
    name = 'pdfsandwich-v5'
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
    from babeldoc.format.pdf.document_il.utils.fontmap import FontMapper
    from babeldoc.format.pdf.document_il.backend.pdf_creater import PDFCreater
    from babeldoc.docvision.base_doclayout import DocLayoutModel
    DocLayoutModel.load_available = staticmethod(functools.cache(DocLayoutModel.load_available))

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
