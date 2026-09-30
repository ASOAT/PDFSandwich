import sys
from pathlib import Path
import pymupdf as fitz
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from pdf_ops import stamp
from translation_file import sync_translation

@pytest.fixture
def files(tmp_path):
    source=tmp_path/'original.pdf';part=tmp_path/'part.pdf';output=tmp_path/'original.zh.pdf'
    with fitz.open() as doc:
        for i in range(3):
            page=doc.new_page();page.insert_text((50,80),f'Original page {i+1}')
        doc[2].set_rotation(90);doc[2].add_rect_annot((40,40,180,100))
        doc.set_toc([[1,'Chapter 1',1],[1,'Chapter 2',2]]);doc.save(source)
    with fitz.open() as doc:
        page=doc.new_page();page.insert_text((50,80),'中文译文',fontname='china-s');doc.save(part)
    return source,part,output

def test_incremental_pages_annotations_outline_rotation_and_original(files):
    source,part,output=files;original=source.read_bytes()
    annotation={'id':'mark','page':0,'kind':'underline','color':'#edba39','origin':'en','accuracy':'manual','content':'A note','en':{'rects':[[50,68,150,84]]},'zh':{'rects':[[50,68,94,84]]}}
    first=sync_translation(source,{'0':str(part)},[annotation],output,stamp(source))
    with fitz.open(output) as doc:
        assert len(doc)==3 and '中文译文' in doc[0].get_text()
        assert 'Original page 2' in doc[1].get_text() and doc[2].rotation==90
        assert len(doc.get_toc())==2 and len(list(doc[2].annots()))==1
        assert len(list(doc[0].annots()))==1
    second=sync_translation(source,{'0':str(part),'1':str(part)},[],output,stamp(source),first['stamp'],[0,1],compact=True)
    assert second['updatedPages']==2
    with fitz.open(output) as doc:
        assert '中文译文' in doc[1].get_text() and not list(doc[0].annots() or [])
        assert 'Original page 3' in doc[2].get_text()
    assert source.read_bytes()==original
    assert not list(output.parent.glob('.*.tmp*'))

def test_external_files_failed_pages_and_stale_sources_are_never_overwritten(files):
    source,part,output=files
    output.write_bytes(b'User-owned existing file')
    with pytest.raises(ValueError,match='未覆盖'):sync_translation(source,{'0':str(part)},[],output,stamp(source))
    assert output.read_bytes()==b'User-owned existing file';output.unlink()
    first=sync_translation(source,{'0':str(part)},[],output,stamp(source));good=output.read_bytes()
    with pytest.raises(Exception):sync_translation(source,{'1':str(part.parent/'missing.pdf')},[],output,stamp(source),first['stamp'],[1])
    assert output.read_bytes()==good
    output.write_bytes(good+b'\n% external change')
    with pytest.raises(ValueError,match='未覆盖'):sync_translation(source,{'0':str(part)},[],output,stamp(source),first['stamp'],[0])
    before=stamp(source);source.write_bytes(source.read_bytes()+b'\n% external source')
    with pytest.raises(ValueError,match='其他程序修改'):sync_translation(source,{'0':str(part)},[],output,before)

def test_original_and_same_name_race_are_protected(files,monkeypatch):
    import translation_file
    source,part,output=files
    with pytest.raises(ValueError,match='不能覆盖'):sync_translation(source,{'0':str(part)},[],source,stamp(source))
    operation='rename' if translation_file.os.name=='nt' else 'link'
    link=getattr(translation_file.os,operation)
    def racing_link(src,dst):
        Path(dst).write_bytes(b'Created by another program');return link(src,dst)
    monkeypatch.setattr(translation_file.os,operation,racing_link)
    with pytest.raises(FileExistsError):sync_translation(source,{'0':str(part)},[],output,stamp(source))
    assert output.read_bytes()==b'Created by another program'
