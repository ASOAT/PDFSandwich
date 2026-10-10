import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import time
from contextlib import contextmanager
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import model_download


@contextmanager
def server(data, ranges=True, corrupt=False, fail_from=None):
    state={'requests':[],'active':0,'peak':0};lock=threading.Lock()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args): pass
        def do_GET(self):
            start,end=map(int,self.headers['Range'][6:].split('-'))
            with lock:
                state['requests'].append((start,end));state['active']+=1
                state['peak']=max(state['peak'],state['active'])
            try:
                time.sleep(.025)
                if fail_from is not None and start>=fail_from:
                    self.send_error(503);return
                self.send_response(206 if ranges else 200)
                payload=data[start:end+1] if ranges else data
                if corrupt:payload=b'x'*len(payload)
                self.send_header('Content-Length',str(len(payload)))
                if ranges:self.send_header('Content-Range',f'bytes {start}-{end}/{len(data)}')
                self.end_headers();self.wfile.write(payload)
            finally:
                with lock:state['active']-=1
    http=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    thread=threading.Thread(target=http.serve_forever,daemon=True);thread.start()
    try:yield f'http://127.0.0.1:{http.server_port}/model',state
    finally:http.shutdown();http.server_close();thread.join()


def test_parallel_blocks_resume_verified_cache_and_legacy_partial(tmp_path,monkeypatch):
    monkeypatch.setattr(model_download,'BLOCK',1024)
    data=bytes(range(256))*32;sha=hashlib.sha256(data).hexdigest();target=tmp_path/'model.bin'
    with server(data,fail_from=4096) as (url,state):
        with pytest.raises(OSError):model_download.download(url,target,sha)
    assert not target.exists()
    assert len(list(tmp_path.glob('*.parts-*/*.ok')))>=4
    with server(data) as (url,state):
        model_download.download(url,target,sha)
        assert target.read_bytes()==data and state['peak']>1
        assert all(a>=4096 or (a,b)==(0,0) for a,b in state['requests'])
        count=len(state['requests']);model_download.download(url,target,sha)
        assert len(state['requests'])==count
    legacy=tmp_path/'legacy.bin';legacy.with_suffix('.bin.download').write_bytes(data[:3000])
    with server(data) as (url,state):
        model_download.download(url,legacy,sha)
        assert legacy.read_bytes()==data and (3000,len(data)-1) in state['requests']


def test_no_range_and_bad_checksum_never_replace_existing_model(tmp_path,monkeypatch):
    monkeypatch.setattr(model_download,'BLOCK',1024)
    data=b'abcdef'*1024;sha=hashlib.sha256(data).hexdigest();target=tmp_path/'model.bin'
    with server(data,ranges=False) as (url,_):model_download.download(url,target,sha)
    assert target.read_bytes()==data
    # Another pinned revision must not reuse a stale verified marker.
    other=data+b'next';other_sha=hashlib.sha256(other).hexdigest()
    with server(other,corrupt=True) as (url,_):
        with pytest.raises(ValueError,match='校验'):model_download.download(url,target,other_sha)
    assert target.read_bytes()==data
