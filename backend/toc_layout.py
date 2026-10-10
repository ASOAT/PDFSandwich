"""Translate real table-of-contents entries without merging rows into prose."""
import json
import re
from pathlib import Path
import pymupdf
from translation_quality import normalize, translation_problem

def contents_entries(page):
    if page.rotation: return None
    raw=[line for block in page.get_text('rawdict')['blocks'] if block['type']==0 for line in block['lines']]
    lines=[]
    for line in raw:
        chars=[{**char,'math':bool(re.search(r'(?:CMMI|CMSY|MSBM|MSAM|CMEX)',span['font']) or span['flags']&1),'baseline':span['origin'][1]} for span in line['spans'] for char in span['chars']]
        text=''.join(char['c'] for char in chars)
        lines.append({'text':text,'chars':chars,'bbox':line['bbox'],'spans':line['spans']})
    leaders=sum(bool(re.search(r'(?:\.\s*){4,}',line['text'])) for line in lines)
    numbers=[line for line in lines if re.fullmatch(r'\s*(?:\d+|[ivxlcdm]+)\s*',line['text'])]
    if leaders<5 or len(numbers)<5: return None
    right=max(line['bbox'][2] for line in numbers)
    entries=[]
    for line in sorted(lines,key=lambda item:(round(item['bbox'][1]/3),item['bbox'][0])):
        text=line['text'];chars=line['chars']
        if not re.search('[A-Za-z]{2}',text) or re.fullmatch(r'\s*[ivxlcdm]+\s*',text):continue
        leader=re.search(r'\s*(?:\.\s*){3,}',text)
        end=leader.start() if leader else len(text)
        prefix=re.match(r'^\s*\d+(?:\.\d+)*\s+',text[:end]);start=prefix.end() if prefix else 0
        suffix=re.search(r'\s+(?:\d+|[ivxlcdm]+)\s*$',text[start:end])
        if suffix:end=start+suffix.start()
        formulas=[];parts=[];i=start
        while i<end:
            char=chars[i]
            if char['math'] and char['c'].strip():
                group=[char];i+=1
                while i<end and chars[i]['math']:
                    if chars[i]['c'].strip():group.append(chars[i])
                    i+=1
                box=pymupdf.Rect(group[0]['bbox'])
                for item in group[1:]:box|=pymupdf.Rect(item['bbox'])
                parts.append('{v'+str(len(formulas))+'}');formulas.append(list(box))
            else:parts.append(char['c']);i+=1
        content=normalize(''.join(parts)).strip()
        if not content:continue
        first,last=chars[start],chars[end-1]
        size=max(span['size'] for span in line['spans'])
        x=first['bbox'][0];y=line['bbox'][1]
        neighbors=[item for item in numbers if abs(item['bbox'][1]-y)<size*.5 and item['bbox'][0]>last['bbox'][2]]
        numbered=any(item['bbox'][2]>right-20 for item in neighbors)
        # White-space boxes next to superscripts can overlap the previous row.
        # Remove only actual glyph groups, rather than the union line rectangle.
        groups={}
        for char in chars[start:]:
            if not char['c'].strip() or char['bbox'][0]>right-20:continue
            key=round(char['baseline'],2)
            if key in groups:groups[key]|=pymupdf.Rect(char['bbox'])
            else:groups[key]=pymupdf.Rect(char['bbox'])
        entry={'text':content,'x':x,'y':y,'bottom':line['bbox'][3],'size':size,'formulas':formulas,
               'end':min([item['bbox'][0]-6 for item in neighbors if item['bbox'][2]>right-20] or [right-20]),
               'rects':[list(rect) for rect in groups.values()],
               'leader':bool(leader),'numbered':numbered,'baseline':line['spans'][0]['origin'][1]}
        if entries and not entries[-1]['numbered'] and not entries[-1]['leader'] and abs(entries[-1]['x']-x)<2 and 0<y-entries[-1]['bottom']<size*.6 and size<16:
            old=entries[-1];offset=len(old['formulas']);content=re.sub(r'\{v(\d+)\}',lambda m:'{v'+str(int(m[1])+offset)+'}',content);old['text']+=' '+content;old['formulas']+=formulas;old['bottom']=entry['bottom'];old['rects']+=entry['rects'];old['leader']=entry['leader'];old['numbered']=numbered;old['lastBaseline']=entry['baseline'];old['end']=entry['end']
        else:entries.append(entry)
    return entries

def translate_contents(source,output,translate,progress):
    with pymupdf.open(source) as doc:
        if len(doc)!=1:return None
        page=doc[0];entries=contents_entries(page)
        if not entries:return None
        from scan_layout import is_searchable_scan, background_color
        scan_color=background_color(page) if is_searchable_scan(page) else None
        changes=[];warnings=[];font=pymupdf.Font('china-s')
        def parts(text):return re.split(r'(\{v\d+\})',text)
        def text_width(entry,text,size):
            return sum((entry['formulas'][int(part[2:-1])][2]-entry['formulas'][int(part[2:-1])][0])*size/entry['size'] if re.fullmatch(r'\{v\d+\}',part) else font.text_length(part,fontsize=size) for part in parts(text))
        for index,entry in enumerate(entries):
            progress(f'逐条翻译目录 {index+1} / {len(entries)}',index/max(1,len(entries))*90)
            try:
                target=translate(entry['text'])
                problem=translation_problem(entry['text'],target)
                if problem:raise ValueError(problem)
                # Fit each entry within its own row, never push following rows down.
                available=entry['end']-entry['x']
                measured=text_width(entry,target,entry['size'])
                size=min(entry['size'],entry['size']*available/max(measured,1))
                if size<entry['size']*.8:raise ValueError('目录译文无法在原行中清晰排下')
                entry.update(target=target,fontSize=size);changes.append(entry)
            except Exception as error:
                warnings.append({'source':entry['text'],'reason':str(error)[:120]})
        for entry in changes:
            for rect in entry['rects']:
                page.add_redact_annot(rect,fill=False,cross_out=False)
        # Text removal must not touch diagrams, images, or numeric columns.
        page.apply_redactions(images=0,graphics=0)
        if scan_color:
            # Removing invisible OCR text does not erase the scanned English.
            # Cover only changed rows; keep page numbers, figures and formulas.
            for entry in changes:
                for rect in entry['rects']:
                    page.draw_rect(pymupdf.Rect(rect)+(-.5,-.5,.5,.5),
                                   color=None,fill=scan_color,overlay=True)
        with pymupdf.open(source) as original:
            for entry in changes:
                size=entry['fontSize'];x=entry['x'];ratio=size/entry['size']
                for part in parts(entry['target']):
                    if re.fullmatch(r'\{v\d+\}',part):
                        box=pymupdf.Rect(entry['formulas'][int(part[2:-1])]);top=entry['baseline']+(box.y0-entry['baseline'])*ratio
                        target=pymupdf.Rect(x,top,x+box.width*ratio,top+box.height*ratio)
                        page.show_pdf_page(target,original,0,clip=box,overlay=True);x+=target.width
                    else:page.insert_text((x,entry['baseline']),part,fontname='china-s',fontsize=size);x+=font.text_length(part,fontsize=size)
                if entry['leader']:
                    baseline=entry.get('lastBaseline',entry['baseline']);start=entry['x'] if 'lastBaseline' in entry else x+8
                    for x in range(int(start),int(entry['end']),5):
                        page.draw_circle((x,baseline-1.3),.35,color=(0,0,0),fill=(0,0,0),overlay=True)
        doc.save(output,garbage=3,deflate=True)
    Path(output).with_name('alignment.json').write_text('[]',encoding='utf-8')
    return {'mode':'contents','entries':len(entries),'translated':len(changes),'warnings':warnings}
