"""Persistent isolated PDF translation worker; credentials arrive on stdin."""
import asyncio
import contextlib
import functools
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import time

_factory=None

async def translate_request(request,send):
    global _factory
    from text_engine import TextEngine
    from toc_layout import translate_contents
    started=time.perf_counter()
    engine=TextEngine(request,lambda message:send({'type':'progress','progress':0,'stage':message}))
    output=Path(request['output']);output.parent.mkdir(parents=True,exist_ok=True)
    temporary=str(output)+'.tmp'
    try:
        toc=translate_contents(request['input'],temporary,engine.translate,
            lambda stage,progress:send({'type':'progress','progress':progress,'stage':stage}))
        if toc is None:
            from pdf2zh_next.config.model import SettingsModel
            from pdf2zh_next.config.translate_engine_model import GoogleSettings
            from pdf2zh_next.translator import BaseTranslator,QPSRateLimiter
            import pdf2zh_next.high_level as high_level
            class Adapter(BaseTranslator):
                name='pdfsandwich-v4'
                model='guarded-text'
                def do_translate(self,text,rate_limit_params=None):return engine.translate(text)
            high_level.get_translator=lambda settings:Adapter(settings,QPSRateLimiter(100 if engine.local is not None else 2))
            if _factory is None:
                _factory=high_level.create_babeldoc_config
                from babeldoc.docvision.base_doclayout import DocLayoutModel
                DocLayoutModel.load_available=staticmethod(functools.cache(DocLayoutModel.load_available))
            def clean_config(value,file):
                clean=value.model_copy(deep=True);clean.basic.debug=False
                return _factory(clean,file)
            high_level.create_babeldoc_config=clean_config
            settings=SettingsModel(translate_engine_settings=GoogleSettings())
            settings.basic.debug=True
            settings.translation.output=str(output.parent/'engine-output')
            settings.translation.lang_in='en';settings.translation.lang_out='zh'
            settings.translation.qps=100 if engine.local is not None else 2
            settings.translation.pool_max_workers=2
            settings.translation.no_auto_extract_glossary=True
            settings.translation.ignore_cache=True
            settings.pdf.no_dual=True;settings.pdf.watermark_output_mode='no_watermark'
            settings.pdf.translate_table_text=False;settings.pdf.ocr_workaround=False
            settings.pdf.auto_enable_ocr_workaround=False;settings.pdf.no_remove_non_formula_lines=True
            settings.pdf.disable_rich_text_translate=True
            last=None
            async for event in high_level.do_translate_async_stream(settings,request['input']):
                kind=event.get('type')
                if kind in ('progress_start','progress_update','progress_end'):
                    progress=round(event.get('overall_progress',0),1);stage=event.get('stage','翻译中')
                    if (progress,stage)!=last:
                        send({'type':'progress','progress':progress,'stage':stage});last=(progress,stage)
                elif kind=='error':raise RuntimeError(event.get('error','翻译失败'))
                elif kind=='finish':
                    result=event['translate_result']
                    source=getattr(result,'no_watermark_mono_pdf_path',None) or getattr(result,'mono_pdf_path',None)
                    if not source or not Path(source).is_file():raise RuntimeError('翻译引擎未生成译文 PDF。')
                    shutil.copyfile(source,temporary);break
        if engine.errors:raise RuntimeError('翻译服务调用失败：'+engine.errors[0])
        warnings=engine.warnings+(toc['warnings'] if toc else [])
        os.replace(temporary,output)
        engine.save_alignment(output.with_name('alignment.json'))
        report={'warnings':warnings,'cachedSegments':engine.hits,'seconds':round(time.perf_counter()-started,2),'layout':'contents' if toc else 'babeldoc'}
        output.with_name('quality.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        send({'type':'finish','path':str(output),'warnings':len(warnings),'seconds':report['seconds']})
    finally:engine.close()

def main(server=False):
    if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
    if hasattr(sys.stdin,'reconfigure'):sys.stdin.reconfigure(encoding='utf-8')
    output=sys.stdout
    logging.disable(logging.CRITICAL)
    for line in sys.stdin:
        request={}
        def send(value):
            output.write(json.dumps({'id':request.get('id'),**value},ensure_ascii=False)+'\n');output.flush()
        try:
            request=json.loads(line)
            with contextlib.redirect_stdout(sys.stderr):asyncio.run(translate_request(request,send))
        except Exception as error:
            message=str(error);key=request.get('settings',{}).get('apiKey')
            if key:message=message.replace(key,'[redacted]')
            send({'type':'error','error':message[:1500]})
            if not server:sys.exit(1)
        if not server:break

if __name__=='__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    main('--translate-server' in sys.argv)
