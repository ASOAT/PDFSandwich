import io
import base64
import sys
from pathlib import Path
import pymupdf as fitz
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from research import research_clip,research_cover,research_identifiers


def test_clips_rotate_correctly_and_select_glyphs(tmp_path):
    path=tmp_path/'example.pdf'
    doc=fitz.open();page=doc.new_page(width=300,height=400)
    page.insert_text((30,70),'First line selected',fontsize=12)
    page.insert_text((30,110),'Second line excluded',fontsize=12)
    page.set_rotation(90);doc.save(path);doc.close()
    result=research_clip(str(path),0,rect=[25,50,200,80],image=True)
    assert 'First line selected' in result['text']
    assert 'Second line' not in result['text']
    image=Image.open(io.BytesIO(base64.b64decode(result['png'])))
    assert image.width in (75,76)
    assert image.height in (437,438)
    high=research_clip(str(path),0,rect=[25,50,200,80],image=True,formula=True)
    formula=Image.open(io.BytesIO(base64.b64decode(high['png'])))
    assert formula.width>image.width and formula.height>image.height
    assert high['text']==result['text']
    output=tmp_path/'cover.png';research_cover(str(path),str(output))
    assert Image.open(output).width==360


def test_identifiers(tmp_path):
    path=tmp_path/'paper.pdf'
    doc=fitz.open();page=doc.new_page();page.insert_text((40,50),'arXiv:1706.03762v7 DOI:10.1234/example')
    doc.set_metadata({'title':'A test paper title'});doc.save(path);doc.close()
    result=research_identifiers(str(path))
    assert result['arxiv']=='1706.03762v7';assert result['doi']=='10.1234/example'


def test_publisher_header_and_word_metadata_do_not_replace_multiline_title(tmp_path):
    path=tmp_path/'publisher.pdf'
    with fitz.open() as doc:
        p=doc.new_page()
        p.insert_text((40,30),'Contents lists available at ScienceDirect',fontsize=10)
        p.insert_text((40,50),'Journal of Scientific Examples 51 (2024) 1-12',fontsize=12)
        p.insert_text((40,90),'Geometry-aware control of',fontsize=20,fontname='hebo')
        p.insert_text((40,115),'nonlinear dynamical systems',fontsize=20,fontname='hebo')
        p.insert_text((40,150),'Alice Smith, Bob Jones, Carol Lee',fontsize=11)
        p.insert_text((40,180),'Department of Engineering, Example University',fontsize=10)
        p.insert_text((40,230),'Abstract',fontsize=12,fontname='hebo')
        p.insert_textbox(fitz.Rect(40,250,540,440),'This abstract contains a long introduction to the scientific problem. '*12,fontsize=10)
        doc.set_metadata({'title':'Microsoft Word - accepted_manuscript.docx'});doc.save(path)
    result=research_identifiers(str(path))
    assert result['title']=='Geometry-aware control of nonlinear dynamical systems'
    assert all('abstract' not in x.lower() and 'Alice' not in x and 'Contents lists' not in x for x in result['titleCandidates'])


def test_visible_title_outranks_stale_but_plausible_embedded_title(tmp_path):
    path=tmp_path/'stale-title.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,90),'Reliable metadata retrieval',fontsize=22,fontname='hebo')
        p.insert_text((40,140),'Alice Smith and Bob Jones',fontsize=11)
        p.insert_text((40,250),'The body of this example uses smaller text than its title.',fontsize=10)
        doc.set_metadata({'title':'An unrelated authoring template title'});doc.save(path)
    result=research_identifiers(str(path))
    assert result['title']=='Reliable metadata retrieval'
    assert result['titleCandidates'][1]=='An unrelated authoring template title'


def test_chinese_title_uses_text_geometry_and_not_journal_banner(tmp_path):
    path=tmp_path/'chinese.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,35),'Journal of Control Science',fontsize=10)
        p.insert_text((60,100),'非线性系统的鲁棒控制方法',fontname='china-s',fontsize=20)
        p.insert_text((60,150),'张三 李四 王五',fontname='china-s',fontsize=11)
        p.insert_text((40,220),'摘要：本文提出一种新的系统控制方法。',fontname='china-s',fontsize=10)
        doc.set_metadata({'title':'untitled'});doc.save(path)
    result=research_identifiers(str(path))
    assert result['title']=='非线性系统的鲁棒控制方法'
    assert all('摘要' not in title and '张三' not in title for title in result['titleCandidates'])


def test_doi_uri_and_wrapped_suffix_preserve_balanced_parentheses(tmp_path):
    path=tmp_path/'doi.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,80),'Reliable metadata retrieval',fontsize=20)
        p.insert_text((40,160),'https://doi.org/10.1016/\nS0000-0000(24)00001-1.',fontsize=10)
        p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(40,145,350,180),'uri':'https://doi.org/10.1016/S0000-0000%2824%2900001-1'})
        doc.save(path)
    result=research_identifiers(str(path))
    assert result['doi']=='10.1016/S0000-0000(24)00001-1'
    assert result['doiCandidates'][0]['source']=='link'
    assert len(result['doiCandidates'])==1


def test_reference_identifiers_do_not_become_document_identifiers(tmp_path):
    path=tmp_path/'references.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,80),'Reliable metadata retrieval',fontsize=20)
        p.insert_text((40,180),'The first page has no article identifier.',fontsize=10)
        p=doc.new_page();p.insert_text((40,50),'References',fontsize=14)
        p.insert_text((40,90),'[1] An unrelated cited article. DOI:10.1234/cited-paper',fontsize=10)
        p.insert_text((40,130),'[2] A preprint. arXiv:1706.03762v7',fontsize=10)
        p.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(40,78,400,96),'uri':'https://doi.org/10.1234/cited-paper'})
        doc.save(path)
    result=research_identifiers(str(path))
    assert result['doi']==result['arxiv']==''
    assert result['doiCandidates']==[]
    assert result['title']=='Reliable metadata retrieval'


def test_numbered_reference_block_continuation_is_not_used_without_heading(tmp_path):
    path=tmp_path/'reference-block.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,80),'Reliable metadata retrieval',fontsize=20)
        p.insert_text((40,150),'[1] Smith and Jones, A cited paper\nhttps://doi.org/10.1234/cited',fontsize=10)
        doc.save(path)
    assert research_identifiers(str(path))['doi']==''


def test_doi_trailing_sentence_punctuation_does_not_remove_real_parentheses(tmp_path):
    path=tmp_path/'doi-parentheses.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,50),'DOI:10.1000/example(2024)).',fontsize=10)
        doc.save(path)
    assert research_identifiers(str(path))['doi']=='10.1000/example(2024)'


def test_publisher_embedded_entities_and_subject_doi_are_recognized(tmp_path):
    path=tmp_path/'publisher-metadata.pdf'
    with fitz.open() as doc:
        p=doc.new_page();p.insert_text((40,80),'Models and Reliable Control',fontsize=20)
        doc.set_metadata({'title':'Models&#x00A0;and Reliable Control','subject':'IEEE Transactions;2025;10.1234/article'})
        doc.save(path)
    result=research_identifiers(str(path))
    assert result['title']=='Models and Reliable Control'
    assert result['doi']=='10.1234/article'
    assert result['doiCandidates'][0]['source']=='metadata'


def test_image_cover_keeps_valid_book_metadata_over_series_name(tmp_path):
    path=tmp_path/'book-cover.pdf'
    with fitz.open() as doc:
        doc.new_page()
        p=doc.new_page();p.insert_text((40,80),'Scientific Monographs',fontsize=28)
        doc.set_metadata({'title':'An Introduction to Geometry'});doc.save(path)
    assert research_identifiers(str(path))['title']=='An Introduction to Geometry'
