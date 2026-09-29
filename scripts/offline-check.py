"""Run a real page translation with all outbound socket connections blocked."""
import io
import json
from pathlib import Path
import socket
import sys
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'backend'))
from pdf_ops import extract_page
from translate import main
if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    folder=root/'tmp/offline-check';folder.mkdir(parents=True,exist_ok=True)
    extract_page(str(root/'tmp/pdfs/reading-sample.pdf'),0,str(folder/'source.pdf'))
    attempts=[]
    original_connect=socket.socket.connect
    def blocked(self,address):
        if isinstance(address,tuple) and address[0] in ('127.0.0.1','::1'):
            return original_connect(self,address)
        attempts.append(str(address))
        raise OSError('Network is disabled during the offline acceptance test')
    socket.socket.connect=blocked
    sys.stdin=io.StringIO(json.dumps({'input':str(folder/'source.pdf'),'output':str(folder/'zh.pdf'),
        'modelDir':str(root/'local-data/models'),'settings':{'provider':'local'}})+'\n')
    main()
    assert not attempts, f'Unexpected network access: {attempts}'
    import pymupdf
    with pymupdf.open(folder/'zh.pdf') as document:
        text=document[0].get_text()
        assert '科学' in text and 'E = mc' in text
        assert 'paragraph[' not in text and 'fallback_line' not in text and '▁' not in text
    print(json.dumps({'offline':True,'networkAttempts':len(attempts),'pageCount':1}))
