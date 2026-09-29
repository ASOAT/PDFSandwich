import sys
from pathlib import Path
import pymupdf
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import pdf_ops

@pytest.fixture
def source(tmp_path):
    path=tmp_path/'original.pdf'
    with pymupdf.open() as doc:
        page=doc.new_page()
        page.insert_text((50,80),'Scientific knowledge grows through observation.',fontsize=12)
        page.add_rect_annot((40,40,350,110))
        doc.save(path)
    return path

def mark(kind='highlight',id='test-id'):
    return {'id':id,'page':0,'kind':kind,'color':'#edba39','content':'中文批注: verified','width':1.5,'origin':'en','en':{'rects':[[50,67,320,84]],'paths':[[[50,100],[80,105],[120,99]]]},'accuracy':'pending'}

def test_save_roundtrip_preserves_text_and_unmanaged_annotations(source):
    before=pdf_ops.inspect(source)
    text=pymupdf.open(source)[0].get_text()
    result=pdf_ops.save_original(source,[mark(),mark('underline','u'),mark('ink','i'),mark('note','n')],before['stamp'],before['baseline'])
    assert len(result['annotations'])==4
    assert Path(result['backup']).is_file()
    with pymupdf.open(source) as doc:
        assert doc[0].get_text()==text
        assert len(list(doc[0].annots()))==5
        assert any(a.info['content']=='中文批注: verified' for a in doc[0].annots())
    result2=pdf_ops.save_original(source,[mark()],result['stamp'],result['baseline'])
    assert len(result2['annotations'])==1
    assert len(list(pymupdf.open(source)[0].annots()))==2

def test_external_edits_are_not_overwritten(source):
    before=pdf_ops.inspect(source)
    with open(source,'ab') as stream:stream.write(b'\n% external change\n')
    with pytest.raises(ValueError,match='其他程序修改'):pdf_ops.save_original(source,[mark()],before['stamp'],before['baseline'])
    assert source.read_bytes().endswith(b'% external change\n')

def test_failed_save_does_not_change_source(source):
    before=pdf_ops.inspect(source);original=source.read_bytes();bad=mark();bad['page']=99
    with pytest.raises(ValueError):pdf_ops.save_original(source,[bad],before['stamp'],before['baseline'])
    assert source.read_bytes()==original

def test_page_mapping_and_exact_quote(source,tmp_path):
    target=tmp_path/'translated.pdf'
    with pymupdf.open() as doc:
        page=doc.new_page();page.insert_text((50,80),'Knowledge develops by observing the world.',fontsize=12);doc.save(target)
    approximate=pdf_ops.map_annotation(source,target,mark())
    assert approximate['accuracy']=='unmatched'
    assert approximate['geometry'] is None
    exact=pdf_ops.map_annotation(source,target,mark(),quote='observing the world')
    assert exact['accuracy']=='phrase'
    assert exact['geometry']['rects'][0][0]>100

def test_search_and_extract_do_not_carry_annotations(source,tmp_path):
    match=pdf_ops.search(source,'Scientific');assert match['matches'][0]['page']==0
    output=tmp_path/'part.pdf';pdf_ops.extract_page(source,0,str(output))
    with pymupdf.open(output) as doc:assert list(doc[0].annots())==[]

def test_rotated_native_annotations_and_translated_export(source,tmp_path):
    with pymupdf.open(source) as doc:
        doc[0].set_rotation(90);doc.saveIncr()
    original=pdf_ops.inspect(source)
    assert isinstance(original['stamp']['mtime'],str)
    item=mark();item['zh']=item['en'];item['origin']='zh'
    result=pdf_ops.save_original(source,[item],original['stamp'],original['baseline'])
    assert result['pages'][0]['rotation']==90
    assert result['annotations'][0]['en']['rects']==item['en']['rects']
    translated=tmp_path/'zh.pdf';pdf_ops.extract_page(source,0,str(translated))
    output=tmp_path/'bilingual.pdf'
    pdf_ops.export_pdf(source,{'0':str(translated)},[item],str(output),'bilingual')
    with pymupdf.open(output) as doc:
        assert len(doc)==2 and all(page.rotation==90 for page in doc)
        assert any(a.info['content']==item['content'] for a in doc[1].annots())

def test_attention_alignment_in_both_directions():
    from local_model import aligned_quote
    records=[{'source':'Scientific knowledge','target':'科学知识',
              'sourceSpans':[[0,10],[10,20]],'targetSpans':[[0,2],[2,4]],'links':[0,1]}]
    assert aligned_quote(records,'knowledge','en')=='知识'
    assert aligned_quote(records,'科学','zh')=='Scientific'
    assert aligned_quote(records,'absent','en') is None
