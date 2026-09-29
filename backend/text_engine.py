"""Shared translation memory, terminology and validation across PDF pages."""
import hashlib
import json
from pathlib import Path
import sqlite3
import threading
import urllib.request
from translation_quality import normalize, translation_problem, translation_prompt

_models={}

class TextEngine:
    def __init__(self,request,progress):
        self.cfg=request['settings'];self.force=request.get('force',False);self.local=None;self.records=[];self.warnings=[];self.errors=[];self.hits=0
        directory=Path(request['modelDir']);directory.mkdir(parents=True,exist_ok=True)
        self.directory=directory;self.progress=progress
        engine=self.cfg.get('localEngine','hy')
        if self.cfg.get('provider','local')=='local':
            identity=(str(directory.resolve()),engine)
            if identity not in _models:
                if engine=='argos':
                    from local_model import LocalModel
                    _models[identity]=LocalModel(directory,progress)
                else:
                    from hy_model import HyModel
                    _models[identity]=HyModel(directory,progress)
            self.local=_models[identity]
            self.local.records=[]
        self.memory=sqlite3.connect(directory/'translation-memory.sqlite',check_same_thread=False)
        self.memory.execute('CREATE TABLE IF NOT EXISTS translations (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        identity={key:self.cfg.get(key) for key in ('provider','localEngine','glossary','useGlossary')}
        if self.local is None:identity.update(baseUrl=self.cfg['baseUrl'],model=self.cfg['model'])
        self.identity=json.dumps(identity,sort_keys=True)+'quality-v5'
        self.lock=threading.Lock()

    def translate(self,text):
        source=normalize(text)
        if not source.strip():return source
        key=hashlib.sha256((self.identity+source).encode()).hexdigest()
        with self.lock:
            row=self.memory.execute('SELECT value FROM translations WHERE key=?',(key,)).fetchone()
            if row and not self.force:
                saved=json.loads(row[0]);self.records.extend(saved['records'] or [self.alignment(source,saved['text'])]);self.hits+=1;return saved['text']
            previous=len(self.local.records) if self.local is not None else 0
            try:
                if self.local is not None:
                    output=self.local.translate(source) if self.cfg.get('localEngine','hy')=='argos' else self.local.translate(source,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True))
                else:
                    body={'model':self.cfg['model'],'messages':[{'role':'user','content':translation_prompt(source,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True))}], 'temperature':0,'stream':False,'max_tokens':min(4096,max(200,len(source)*2))}
                    if 'api.deepseek.com' in self.cfg['baseUrl']:body['thinking']={'type':'disabled'}
                    req=urllib.request.Request(self.cfg['baseUrl'].rstrip('/')+'/chat/completions',data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+(self.cfg.get('apiKey') or 'local')})
                    with urllib.request.urlopen(req,timeout=90) as response:result=json.load(response)
                    choice=result['choices'][0]
                    if choice.get('finish_reason')=='length':raise ValueError('译文长度超限')
                    output=choice['message']['content'].strip()
                problem=translation_problem(source,output)
                if problem:raise ValueError(problem)
            except ValueError as error:
                self.warnings.append({'source':source[:100],'reason':str(error)[:150]})
                return source
            except Exception as error:
                self.errors.append(str(error)[:200])
                raise
            records=self.local.records[previous:] if self.local is not None else []
            if not records:records=[self.alignment(source,output)]
            self.records.extend(records)
            self.memory.execute('INSERT OR REPLACE INTO translations VALUES (?,?)',(key,json.dumps({'text':output,'records':records},ensure_ascii=False)));self.memory.commit()
            return output

    def alignment(self,source,target):
        from translation_quality import matching_terms
        return {'source':source,'target':target,'terms':matching_terms(source,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True))}

    def close(self):self.memory.close()

    def save_alignment(self,file):
        from alignment import make_record
        self.records=[record if 'links' in record else make_record(record['source'],record['target'],self.directory,self.progress,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True)) for record in self.records]
        Path(file).write_text(json.dumps(self.records,ensure_ascii=False),encoding='utf-8')
