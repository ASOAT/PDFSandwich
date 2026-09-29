import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import pymupdf
import pytest
from translation_quality import translation_problem, matching_terms, glossary_entries
from toc_layout import contents_entries, translate_contents

def test_rejects_repetition_without_rejecting_valid_short_translation():
    assert translation_problem('Brief History', '简史') is None
    assert translation_problem('Rigid Body Motion', '刚体运动') is None
    assert translation_problem('A section title', '南本'*70)
    assert translation_problem('A heading', '这是一个重复片段'*8)
    assert translation_problem('Formula {v0} stays.', '公式保留。')
    assert translation_problem('Formula {v0} stays.', '公式 {v0} 保留。') is None

def test_glossary_preserves_boundaries_ligatures_and_user_choice():
    terms=dict(matching_terms('Multiﬁngered hands use twists.','TWISTS = 自定义旋量'))
    assert terms['multifingered']=='多指'
    assert terms['TWISTS']=='自定义旋量'
    assert 'twist' not in terms
    assert not matching_terms('overembeddingness',use_builtin=True)
    with pytest.raises(ValueError):glossary_entries('invalid')

def make_contents(path):
    with pymupdf.open() as doc:
        page=doc.new_page(width=500,height=650)
        page.insert_text((50,60),'Contents',fontsize=20)
        for i in range(7):
            y=110+i*35
            page.insert_text((50,y),str(i+1),fontsize=11)
            page.insert_text((80,y),f'Section title {i+1}',fontsize=11)
            page.insert_text((220,y),'. . . . . . . . . . . . . . .',fontsize=11)
            page.insert_text((420,y),str(10+i),fontsize=11)
        page.draw_rect((50,450,100,490),color=(1,0,0))
        doc.save(path)

def test_contents_preserves_numeric_columns_artwork_and_row_positions(tmp_path):
    source=tmp_path/'source.pdf';output=tmp_path/'zh.pdf';make_contents(source)
    with pymupdf.open(source) as doc:
        assert contents_entries(doc[0])
        before=[(w[:4],w[4]) for w in doc[0].get_text('words') if w[0]>410]
    result=translate_contents(source,str(output),lambda text:'目录' if text=='Contents' else '测试章节',lambda *_:None)
    assert result['translated']==8
    with pymupdf.open(output) as doc:
        assert '测试章节' in doc[0].get_text()
        after=[(w[:4],w[4]) for w in doc[0].get_text('words') if w[0]>410]
        assert before==after
        assert any(item['rect']==pymupdf.Rect(50,450,100,490) for item in doc[0].get_drawings())
        assert len(doc[0].search_for('测试章节'))==7

def test_contents_leaves_original_entry_if_translation_is_corrupt(tmp_path):
    source=tmp_path/'source.pdf';output=tmp_path/'zh.pdf';make_contents(source)
    result=translate_contents(source,str(output),lambda text:'南本'*100,lambda *_:None)
    assert result['translated']==0 and result['warnings']
    with pymupdf.open(output) as doc:assert 'Section title' in doc[0].get_text()

def test_cloud_adapter_glossary_cache_and_failures(tmp_path):
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from text_engine import TextEngine
    calls=[]
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*_):pass
        def do_POST(self):
            body=json.loads(self.rfile.read(int(self.headers['Content-Length'])));calls.append(body)
            prompt=body['messages'][0]['content']
            if 'quota-test' in prompt:self.send_response(429);self.end_headers();return
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers()
            text='南本'*100 if 'repeat-test' in prompt else '扭量'
            self.wfile.write(json.dumps({'choices':[{'message':{'content':text},'finish_reason':'stop'}]}).encode())
    server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    request={'modelDir':str(tmp_path),'settings':{'provider':'api','baseUrl':f'http://127.0.0.1:{server.server_port}','model':'test','glossary':'twist = 扭量'}}
    engine=TextEngine(request,lambda *_:None)
    try:
        assert engine.translate('twist')=='扭量'
        assert 'twist 翻译成 扭量' in calls[0]['messages'][0]['content']
        assert engine.translate('twist')=='扭量' and len(calls)==1
        assert engine.translate('repeat-test')=='repeat-test' and len(engine.warnings)==1
        with pytest.raises(Exception):engine.translate('quota-test')
        assert engine.errors
    finally:engine.close();server.shutdown();server.server_close();thread.join()
