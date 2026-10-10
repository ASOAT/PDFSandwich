from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
import json
import sys
from pathlib import Path
import threading
import time
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from hy_model import HyModel
from cancellation import PageControl,PageCancelled


def test_streaming_cancel_releases_blocked_read_and_next_request_succeeds(tmp_path):
    started=threading.Event();release=threading.Event()
    class Handler(BaseHTTPRequestHandler):
        def log_message(self,*args):pass
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            assert payload['stream'] is True
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
            self.wfile.write(b'data: {"choices":[{"delta":{"content":""}}]}\n\n');self.wfile.flush()
            if not started.is_set():
                started.set();release.wait(4)
            else:
                self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':'机器人正在移动。'},'finish_reason':'stop'}]})+'\n\ndata: [DONE]\n\n').encode());self.wfile.flush()
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
    model=HyModel.__new__(HyModel);model.url=f'http://127.0.0.1:{server.server_port}';model.key='test'
    cancel=tmp_path/'cancel';control=PageControl({'cancelFile':str(cancel)})
    def interrupt():
        started.wait(2);time.sleep(.05);cancel.touch()
    interrupter=threading.Thread(target=interrupt);interrupter.start()
    try:
        start=time.monotonic()
        with pytest.raises(PageCancelled):model.translate('The robot moves.',control=control)
        assert time.monotonic()-start<2
        cancel.unlink()
        assert model.translate('The robot moves.',control=control)=='机器人正在移动。'
    finally:
        release.set();interrupter.join();server.shutdown();server.server_close();worker.join()
