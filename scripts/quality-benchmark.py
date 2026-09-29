"""Local-only regression on a supplied book; never edits or uploads its source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import shutil
import sys
import time
import pymupdf

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--book',required=True);parser.add_argument('--baseline',action='store_true');parser.add_argument('--repeat-body',action='store_true');args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];folder=root/'tmp/quality-benchmark';folder.mkdir(parents=True,exist_ok=True)
    sys.path.insert(0,str(root/'backend'));from pdf_ops import extract_page
    before=hashlib.sha256(Path(args.book).read_bytes()).hexdigest()
    samples=[('contents',4),('body',18),('formulas',38)]
    if args.repeat_body:samples.append(('body-warm',18))
    for name,index in samples:extract_page(args.book,index,str(folder/(name+'.pdf')))
    report=[]
    def run(child,label,name,number,engine):
        output=folder/f'{label}-{name}.pdf'
        request={'id':number,'input':str(folder/(name+'.pdf')),'output':str(output),'force':True,'modelDir':str(root/'local-data/models'),'settings':{'provider':'local','localEngine':engine,'useGlossary':True,'glossary':''}}
        start=time.perf_counter();child.stdin.write(json.dumps(request)+'\n');child.stdin.flush();last=None
        for line in child.stdout:
            event=json.loads(line)
            if event['type']=='error':raise RuntimeError(event['error'])
            if event['type']=='progress' and event.get('stage')!=last:
                last=event.get('stage');print(json.dumps({'run':label,'page':name,'stage':last,'elapsed':round(time.perf_counter()-start,2)},ensure_ascii=False),flush=True)
            if event['type']=='finish':break
        else:raise RuntimeError('Translation worker exited early')
        item={'engine':label,'page':name,'seconds':round(time.perf_counter()-start,2),'warnings':event.get('warnings')}
        for sidecar in ('alignment','quality'):
            if (folder/(sidecar+'.json')).exists():shutil.copyfile(folder/(sidecar+'.json'),folder/f'{label}-{name}-{sidecar}.json')
        with pymupdf.open(output) as doc:
            item['characters']=len(doc[0].get_text());doc[0].get_pixmap(matrix=pymupdf.Matrix(1.5,1.5)).save(folder/f'{label}-{name}.png')
            (folder/f'{label}-{name}.txt').write_text(doc[0].get_text(),encoding='utf-8')
            if label=='new' and name=='contents':
                import re
                with pymupdf.open(folder/'contents.pdf') as original:
                    # Chapter/page columns stay in place; mathematical superscripts
                    # may legitimately move with their translated title.
                    anchors=[word for word in original[0].get_text('words') if re.fullmatch(r'\d+(?:\.\d+)*|[ivxlcdm]+',word[4]) and (word[0]<205 or word[0]>440)]
                    rendered=doc[0].get_text('words')
                    for anchor in anchors:
                        assert any(word[4]==anchor[4] and abs(word[0]-anchor[0])<.2 and abs(word[1]-anchor[1])<.2 for word in rendered),f'Contents numbering moved: {anchor[4]}'
        report.append(item);print(json.dumps(item),flush=True)
    if args.baseline:
        for number,(name,_) in enumerate(samples):
            with (folder/f'old-{name}.log').open('w',encoding='utf-8') as log:
                child=subprocess.Popen([str(root/'release/0.1.2/win-unpacked/resources/backend/pdfsandwich-worker.exe'),'--translate'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
                run(child,'old',name,number,'argos');child.stdin.close();child.wait(timeout=30)
    with (folder/'new.log').open('w',encoding='utf-8') as log:
        command=[os.environ['PDFSANDWICH_WORKER'],'--translate-server'] if os.environ.get('PDFSANDWICH_WORKER') else [sys.executable,'-u',str(root/'backend/worker.py'),'--translate-server']
        child=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=log,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            for number,(name,_) in enumerate(samples):run(child,'new',name,number,'hy')
        finally:child.stdin.close();child.wait(timeout=30)
    assert hashlib.sha256(Path(args.book).read_bytes()).hexdigest()==before
    (folder/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');main()
