"""Shared translation memory, terminology and validation across PDF pages."""
import asyncio
import hashlib
import json
import re
from pathlib import Path
import sqlite3
import threading
from translation_quality import normalize, translation_problem, translation_prompt, translation_units
from cancellation import PageControl, PageCancelled

_models={}

class TextEngine:
    def __init__(self,request,progress,loop=None):
        self.cfg=request['settings'];self.force=request.get('force',False);self.local=None;self.records=[];self.warnings=[];self.errors=[];self.hits=0
        self.control=PageControl(request);self.control.check();self.repaired=0
        directory=Path(request['modelDir']);directory.mkdir(parents=True,exist_ok=True)
        self.directory=directory;self.progress=progress
        from translation_context import page_edges
        api = self.cfg.get('provider') == 'api'
        self.page_context=page_edges(request, include_opening=api);self.context={}
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
        self.identity=json.dumps(identity,sort_keys=True)+'quality-v12'
        self.cloud = None
        self.loop = loop
        if api:
            self.identity += '-cloud-batch-v1'
            if loop is not None:
                from cloud_translation import CloudClient
                self.cloud = CloudClient(self.cfg)
        self.lock=threading.Lock()

    def translate(self,text):
        from translation_context import unpack
        text,context=unpack(text)
        reference=text.startswith('\x1ereference\x1f')
        source=normalize(text.removeprefix('\x1ereference\x1f'))
        if not source.strip():return source
        self.control.check()
        with self.lock:
            self.control.check()
            self.context=context
            try:
                if reference:output,records=self.translate_reference(source)
                else:output,records=self.translate_structured(source)
                self.records.extend(records)
                return output
            except PageCancelled:raise
            except Exception as error:
                self.errors.append(str(error)[:200])
                raise
            finally:self.context={}

    def translate_structured(self, source, literals=True):
        """Own brackets and citation identity instead of asking a model to copy them."""
        from translation_structure import protected_ranges, visible, styled_slice, scientific_literals
        if literals:
            ranges=scientific_literals(source,self.context)
            if ranges:
                next_id=max([int(x) for x in re.findall(r'\{\s*v\s*(\d+)\s*\}',source)] or [0])+1
                replacements={};parts=[];offset=0
                for start,end,value in ranges:
                    parts.append(styled_slice(source,offset,start))
                    replacements[next_id]=value;parts.append('{v'+str(next_id)+'}')
                    next_id+=1;offset=end
                parts.append(styled_slice(source,offset,len(source)))
                output,_=self.translate_structured(''.join(parts),literals=False)
                output=re.sub(r'\{\s*v\s*(\d+)\s*\}',lambda m:replacements.get(int(m[1]),m[0]),output)
                return output,[self.alignment(visible(source),visible(output))]
        ranges=list(protected_ranges(source))
        if not ranges:
            return self.translate_styled(source) if "<style id=" in source else self.translate_cached(source)
        next_id=max([int(x) for x in re.findall(r'\{\s*v\s*(\d+)\s*\}',source)] or [0])+1
        replacements={};parts=[];offset=0
        for start,end,inner in ranges:
            parts.append(styled_slice(source,offset,start))
            value=styled_slice(source,start,end) if inner is None else styled_slice(source,start,start+1)+self.translate_structured(styled_slice(source,start+1,end-1))[0]+styled_slice(source,end-1,end)
            replacements[next_id]=value;parts.append('{v'+str(next_id)+'}')
            next_id+=1;offset=end
        parts.append(styled_slice(source,offset,len(source)));protected=''.join(parts)
        output,_=self.translate_styled(protected) if "<style id=" in protected else self.translate_cached(protected)
        output=re.sub(r'\{\s*v\s*(\d+)\s*\}',lambda m:replacements.get(int(m[1]),m[0]),output)
        return output,[self.alignment(visible(source),visible(output))]

    def translate_reference(self, source):
        """Translate the title, keeping bibliographic identity text verbatim."""
        tags = re.compile(r"(</?style(?: id='\d+')?>)")
        visible = tags.sub('', source)
        author_end = re.search(r'(?<=[A-Za-zÀ-ž]{2})\.\s*(?=[A-Z])', visible)
        if not author_end:
            return source, [self.alignment(visible, visible)]
        start = author_end.end()
        # Some references begin with a title and then "In ..." (no authors).
        if visible[start:].startswith('In '):
            start = 0
        rest = visible[start:]
        end_match = re.search(r'\.\s*(?:In\b|[A-Z])|,\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|volume\b|pages\b|vol\.|pp\.|\d{4}\b)', rest)
        end = start+end_match.start() if end_match else len(visible.rstrip('. '))
        offset = 0
        parts = []
        for part in tags.split(source):
            if tags.fullmatch(part):
                parts.append(part)
                continue
            a, b = max(start-offset, 0), min(end-offset, len(part))
            if a < b:
                value = part[a:b]
                literals = {}
                next_id = max([int(x) for x in re.findall(r'\{\s*v\s*(\d+)\s*\}', source)] or [0])+1
                def protect_literal(match):
                    key = next_id+len(literals)
                    literals[key] = match[0]
                    return '{v'+str(key)+'}'
                value = re.sub(r'\$[^$]+\$', protect_literal, value)
                translated, _ = self.translate_cached(value)
                translated = re.sub(r'\{\s*v\s*(\d+)\s*\}', lambda m:literals.get(int(m[1]),m[0]), translated)
                parts.append(part[:a]+translated+part[b:])
            else:
                parts.append(part)
            offset += len(part)
        output = ''.join(parts)
        return output, [self.alignment(visible, tags.sub('', output))]

    def translate_styled(self, source):
        """Keep style markup under application control, out of model output.

        Translate a styled phrase once, then protect it as a formula-like token
        while translating its surrounding sentence. Align the final visible
        text, not internal tags or the temporary style tokens.
        """
        pattern = re.compile(r"(?:(\b(?:A|An|The|a|an|the)\s+))?(<style id='\d+'>)(.*?)</style>", re.S)
        next_id = max([int(x) for x in re.findall(r'\{\s*v\s*(\d+)\s*\}', source)] or [0]) + 1
        replacements = {}
        def protect(match):
            nonlocal next_id
            # Keep an article with the phrase it qualifies. A standalone "A"
            # beside an opaque style token otherwise gets treated as a label.
            value, _ = self.translate_cached((match[1] or '')+match[3])
            if match[3].rstrip().endswith('.') and not value.rstrip().endswith(('.', '。', '！', '？')):
                value = value.rstrip()+'。'
            marker = next_id; next_id += 1
            replacements[marker] = match[2] + value + '</style>'
            return '{v' + str(marker) + '}'
        protected = pattern.sub(protect, source)
        output, _ = self.translate_cached(protected)
        output = re.sub(r'\{\s*v\s*(\d+)\s*\}',
                        lambda m: replacements.get(int(m[1]), m[0]), output)
        visible = lambda text: re.sub(r"</?style(?: id='\d+')?>", '', text)
        return output, [self.alignment(visible(source), visible(output))]

    def generate(self,source):
        if self.local is not None:
            return self.local.translate(source) if self.cfg.get('localEngine','hy')=='argos' else self.local.translate(source,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True),context=self.context,control=self.control)
        context = dict(self.context)
        if opening := self.page_context.get('opening'):
            context['documentOpening'] = opening
        prompt = translation_prompt(source, self.cfg.get('glossary', ''), self.cfg.get('useGlossary', True), context=context)
        return self.cloud_complete([{'role': 'user', 'content': prompt}], min(4096, max(200, len(source)*2)))

    def cloud_complete(self, messages, max_tokens):
        # BabelDOC runs layout in a worker thread. Keep the HTTP connection
        # pool on the page's event loop so changing pages can abort its reads.
        request = self.cloud.complete(messages, max_tokens, control=self.control, on_retry=self.progress)
        return asyncio.run_coroutine_threadsafe(request, self.loop).result()

    def cache_key(self, source, context):
        opening = self.page_context.get('opening', '') if self.cfg.get('provider') == 'api' else ''
        return hashlib.sha256((self.identity+json.dumps(context,sort_keys=True)+opening+source).encode()).hexdigest()

    def load_cached(self, key, source):
        if self.force:
            return None
        row = self.memory.execute('SELECT value FROM translations WHERE key=?', (key,)).fetchone()
        if row:
            saved = json.loads(row[0])
            if not translation_problem(source, saved['text']):
                self.hits += 1
                return saved['text'], saved['records'] or [self.alignment(source, saved['text'])]
        return None

    def store_cached(self, key, text, records):
        self.memory.execute('INSERT OR REPLACE INTO translations VALUES (?,?)',
                            (key, json.dumps({'text': text, 'records': records}, ensure_ascii=False)))

    def translate_group(self, texts):
        from translation_batch import protect_for_batch, restore_literals, batch_messages, parse_batch
        from translation_context import unpack

        self.control.check()
        batch = []
        plans = {}
        results = {}
        for index, text in enumerate(texts):
            original, context = unpack(text)
            if original.startswith('\x1ereference\x1f'):
                continue
            original = normalize(original)
            plan = protect_for_batch(original, context)
            if plan is None:
                continue
            source, literals = plan
            # A different cache namespace keeps batch translations and their
            # independent repairs from masking one another.
            key = self.cache_key('batch\x1f'+source, context)
            plans[index] = (original, literals, key)
            if saved := self.load_cached(key, source):
                results[index] = saved[0]
            else:
                batch.append({'id': index, 'text': source, 'context': context})

        if len(batch) >= 2:
            messages = batch_messages(batch, self.page_context.get('opening', ''),
                                      self.cfg.get('glossary', ''), self.cfg.get('useGlossary', True))
            try:
                generated = parse_batch(self.cloud_complete(messages, 4096), {item['id']: item['text'] for item in batch})
            except ValueError:
                generated = {}
            for index, value in generated.items():
                self.store_cached(plans[index][2], value, [])
            self.memory.commit()
            results.update(generated)

        for index, text in enumerate(texts):
            self.control.check()
            if index in results:
                original, literals, _ = plans[index]
                output = restore_literals(results[index], literals)
                self.records.append(self.alignment(original, output))
                yield output
            else:
                yield self.translate(text)

    def translate_cached(self,source,repair=True):
        self.control.check()
        if not re.search(r'[A-Za-z]{2}',source) or re.fullmatch(r'\s*\{\s*v\s*\d+\s*\}\s*',source):return source,[]
        key=self.cache_key(source,self.context)
        if saved := self.load_cached(key, source):
            return saved
        warnings=len(self.warnings)
        previous=len(self.local.records) if self.local is not None else 0
        units=translation_units(source, 1800 if self.cloud else 600)
        if len(units)>1:
            output=' '.join(self.translate_cached(unit.strip(),repair)[0] for unit in units if unit.strip())
            records=[self.alignment(source,output)]
        else:
            try:
                output=self.generate(source)
                problem=translation_problem(source,output)
                if problem:raise ValueError(problem)
                records=self.local.records[previous:] if self.local is not None else []
            except ValueError as error:
                self.control.check()
                if self.local is not None:del self.local.records[previous:]
                if not repair:
                    self.warnings.append({'source':source[:100],'reason':str(error)[:150]})
                    return source,[]
                self.progress('正在分段补译，保留公式…')
                # Retry complete sentences before resorting to fragments: an
                # isolated "is associated with the" invites invented ellipses.
                from alignment import sentence_spans
                sentences=[source[a:b].strip() for a,b in sentence_spans(source,True)]
                if len(sentences)>1:
                    output=' '.join(self.translate_cached(part,True)[0] for part in sentences)
                else:
                    # Last resort keeps every original formula even when the
                    # model cannot copy its token. Retry once per fragment.
                    parts=re.split(r'(\{\s*v\s*\d+\s*\})',source)
                    pieces=[unit.strip() for part in parts for unit in translation_units(part,200) if unit.strip()]
                    output=' '.join(self.translate_cached(part,False)[0] for part in pieces)
                records=[self.alignment(source,output)]
                if len(self.warnings)==warnings:self.repaired+=1
        if not records:records=[self.alignment(source,output)]
        if len(self.warnings)==warnings:
            self.store_cached(key, output, records)
            self.memory.commit()
        # Store a completed segment before yielding, so resuming does not redo it.
        self.control.check()
        return output,records

    def alignment(self,source,target):
        from translation_quality import matching_terms
        return {'source':source,'target':target,'terms':matching_terms(source,self.cfg.get('glossary',''),self.cfg.get('useGlossary',True))}

    def close(self):self.control.close();self.memory.close()

    def save_alignment(self,file):
        # Rendering a page must not wait for a second model download/inference.
        # Exact terms and complete sentences align without it. Refine only the
        # selected records on demand when the reader actually adds a mark.
        for record in self.records:
            if 'links' not in record:
                record['alignmentPending']=True
        Path(file).write_text(json.dumps(self.records,ensure_ascii=False),encoding='utf-8')
