"""Isolated layout-preserving translation. Credentials arrive over stdin, never argv."""
import asyncio
import contextlib
import json
import logging
import os
import shutil
import sys
from pathlib import Path


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    request = json.loads(sys.stdin.readline())
    output_stream = sys.stdout

    def send(value):
        output_stream.write(json.dumps(value, ensure_ascii=False) + "\n")
        output_stream.flush()

    async def run():
        from pdf2zh_next.config.model import SettingsModel
        from pdf2zh_next.config.translate_engine_model import OpenAISettings, GoogleSettings
        import pdf2zh_next.high_level as high_level
        cfg = request["settings"]
        local = None
        if cfg.get("provider", "local") == "local":
            from local_model import LocalModel
            from pdf2zh_next.translator import BaseTranslator, QPSRateLimiter
            local = LocalModel(request["modelDir"], lambda message: send({"type":"progress","progress":0,"stage":message}))
            class LocalTranslator(BaseTranslator):
                name = "argos-en-zh-1.9"
                model = "argos-en-zh-1.9"
                def do_translate(self, text, rate_limit_params=None):
                    return local.translate(text)
            # A process-local adapter into the pinned 2.9.0 facade; no upstream source is changed.
            high_level.get_translator = lambda settings: LocalTranslator(settings, QPSRateLimiter(100))
            engine = GoogleSettings()
        else:
            engine = OpenAISettings(openai_model=cfg["model"], openai_base_url=cfg["baseUrl"],
                                openai_api_key=cfg.get("apiKey") or "local", openai_timeout="90",
                                openai_enable_json_mode=False, openai_send_temprature=False)
        if local is None and "api.deepseek.com" in cfg["baseUrl"]:
            engine._openai_extra_body = {"thinking": {"type": "disabled"}}
        settings = SettingsModel(translate_engine_settings=engine)
        # This entire process is already isolated; avoid another spawned interpreter.
        settings.basic.debug = True
        # The facade uses debug to select in-process execution. Build its layout
        # configuration separately with debug disabled so diagnostic boxes never
        # leak into the reader's PDF. This adapter is pinned to pdf2zh-next 2.9.0.
        config_factory = high_level.create_babeldoc_config
        def clean_config(value, file):
            clean = value.model_copy(deep=True)
            clean.basic.debug = False
            return config_factory(clean, file)
        high_level.create_babeldoc_config = clean_config
        settings.translation.output = str(Path(request["output"]).parent / "engine-output")
        settings.translation.lang_in = "en"
        settings.translation.lang_out = "zh"
        settings.translation.qps = 2
        settings.translation.pool_max_workers = 2
        settings.translation.no_auto_extract_glossary = True
        settings.pdf.no_dual = True
        settings.pdf.watermark_output_mode = "no_watermark"
        settings.pdf.translate_table_text = False
        settings.pdf.ocr_workaround = False
        settings.pdf.auto_enable_ocr_workaround = False
        settings.pdf.no_remove_non_formula_lines = True
        if local is not None:
            settings.pdf.disable_rich_text_translate = True
            settings.translation.ignore_cache = True
        last_progress = -1
        async for event in high_level.do_translate_async_stream(settings, request["input"]):
            kind = event.get("type")
            if kind in ("progress_start", "progress_update", "progress_end"):
                progress = round(event.get("overall_progress", 0), 1)
                if progress != last_progress:
                    send({"type": "progress", "progress": progress, "stage": event.get("stage", "翻译中")})
                    last_progress = progress
            elif kind == "error":
                raise RuntimeError(event.get("error", "翻译失败"))
            elif kind == "finish":
                result = event["translate_result"]
                source = getattr(result, "no_watermark_mono_pdf_path", None) or getattr(result, "mono_pdf_path", None)
                if not source or not Path(source).is_file():
                    raise RuntimeError("翻译引擎未生成译文 PDF。")
                temp = request["output"] + ".tmp"
                shutil.copyfile(source, temp)
                os.replace(temp, request["output"])
                if local is not None:
                    local.save_alignment(str(Path(request["output"]).with_name("alignment.json")))
                send({"type": "finish", "path": request["output"]})
                break

    logging.disable(logging.CRITICAL)
    try:
        with contextlib.redirect_stdout(sys.stderr):
            asyncio.run(run())
    except Exception as error:
        message = str(error)
        if request["settings"].get("apiKey"):
            message = message.replace(request["settings"]["apiKey"], "[redacted]")
        send({"type": "error", "error": message[:1500]})
        sys.exit(1)


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
