"""Persistent isolated PDF translation worker; credentials arrive on stdin."""
import asyncio
import contextlib
import json
import logging
import os
from pathlib import Path
import shutil
import sys
import time

async def translate_request(request,send):
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
            send({'type':'progress','progress':0,'stage':'正在准备排版引擎（首次启动较慢）…'})
            profile=None
            if request.get('profileStartup'):
                import cProfile
                profile=cProfile.Profile();profile.enable()
            from babeldoc.format.pdf.high_level import async_translate
            from babeldoc.format.pdf.translation_config import TranslationConfig, WatermarkOutputMode
            from layout_runtime import install, LayoutTranslator
            install()
            config=TranslationConfig(translator=LayoutTranslator(engine), input_file=Path(request['input']),
                lang_in='en', lang_out='zh', doc_layout_model=None,
                output_dir=str(output.parent/'engine-output'), debug=False, no_dual=True,
                watermark_output_mode=WatermarkOutputMode.NoWatermark,
                qps=100 if engine.local is not None else 2, pool_max_workers=2,
                auto_extract_glossary=False, table_model=None, ocr_workaround=False,
                auto_enable_ocr_workaround=False, remove_non_formula_lines=False,
                disable_rich_text_translate=True, use_rich_pbar=False)
            if profile:
                import pstats
                profile.disable()
                with output.with_name('startup-profile.txt').open('w',encoding='utf-8') as stream:
                    pstats.Stats(profile,stream=stream).sort_stats('cumulative').print_stats(50)
            last=None
            async for event in async_translate(config):
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
