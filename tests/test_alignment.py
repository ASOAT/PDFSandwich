import json
import sys
from pathlib import Path
import pymupdf as fitz
sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'backend'))
from alignment import aligned_ranges, compact, sentence_pairs, sentence_spans, utf8_boundaries


def test_byte_offsets_do_not_shift_words_after_math_or_curly_quotes():
    value='alpha α body 科学'
    offsets=utf8_boundaries(value)
    assert value[offsets[8]:offsets[13]]==' body'
    assert offsets[len(value.encode('utf-8'))]==len(value)


def test_sentence_alignment_keeps_initials_and_split_sentence_offsets():
    source='The play R. U. R. introduced robots. Robots work.'
    target='戏剧引入了机器人。机器人工作。'
    parts=sentence_pairs(source,target)
    assert len(parts)==2
    assert source[slice(*parts[0][0])].strip()=='The play R. U. R. introduced robots.'
    assert target[slice(*parts[1][1])]=='机器人工作。'
    assert len(sentence_spans(source,True))==2
    merged=sentence_pairs('Robots weld and paint. They move.','机器人焊接。它们喷漆。它们移动。')
    assert merged[0][1]==(0,len('机器人焊接。它们喷漆。'))
from annotation_alignment import map_records
from alignment import anchored_pairs


def test_formula_anchors_prevent_sentence_pair_drift():
    source='A heading. Energy function {v1} follows a distribution {v2}. More text.'
    target='标题与能量函数{v1}服从分布{v2}。其他文字。'
    pairs=anchored_pairs(source,target)
    assert any('distribution' in source[a:b] and '分布' in target[c:d] for (a,b),(c,d) in pairs)
    assert all('{v' not in source[a:b] and '{v' not in target[c:d] for (a,b),(c,d) in pairs)


def test_styled_extraction_does_not_require_whole_paragraph_match():
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        s.insert_text((50,80),'Notations:',fontsize=12)
        s.insert_text((115,80),' The state is x.',fontsize=12)
        t.insert_text((50,80),'符号约定：',fontname='china-s',fontsize=12)
        t.insert_text((115,80),'状态为 x。',fontname='china-s',fontsize=12)
        record={'source':'Notations: The state is {v1}.','target':'符号约定: 状态是 {v1}。','terms':[['Notations','符号约定']]}
        item={'origin':'en','selectedText':'Notations','en':{'rects':[list(s.search_for('Notations')[0])]}}
        result=map_records(s,t,item,[record])
        assert result and result['accuracy']=='phrase'
        reverse={'origin':'zh','selectedText':'符号约定','zh':result['geometry']}
        assert map_records(t,s,reverse,[record])['accuracy']=='phrase'


def test_terms_override_diffuse_attention_and_reverse_subwords():
    record={'source':'A rigid body moves.', 'target':'一个刚体发生运动。',
            'terms':[['rigid body','刚体']]}
    assert aligned_ranges(record,2,12,'en')==[(2,4)]
    assert aligned_ranges(record,2,4,'zh')==[(2,12)]
    assert compact('science ﬁc-\ntion')=='sciencefiction'


def test_disjoint_translation_does_not_mark_intervening_words():
    record={'source':'A B C', 'target':'甲乙丙丁', 'sourceSpans':[[0,1],[2,3],[4,5]],
            'targetSpans':[[0,1],[1,2],[2,3],[3,4]],'links':[0,2,1,2]}
    assert aligned_ranges(record,0,3,'en')==[(0,1),(2,3)]


def test_repeated_terms_use_selected_source_geometry_and_wrapped_target(tmp_path):
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        s.insert_text((50,80),'Rigid body motion.',fontsize=12)
        s.insert_text((50,180),'A rigid body rotates.',fontsize=12)
        t.insert_text((50,80),'刚体运动。',fontname='china-s',fontsize=12)
        t.insert_text((50,180),'一个刚体',fontname='china-s',fontsize=12)
        t.insert_text((50,200),'发生旋转。',fontname='china-s',fontsize=12)
        records=[{'source':'Rigid body motion.','target':'刚体运动。','terms':[['rigid body','刚体']]},
                 {'source':'A rigid body rotates.','target':'一个刚体发生旋转。','terms':[['rigid body','刚体']]}]
        item={'origin':'en','selectedText':'rigid body','en':{'rects':[list(s.search_for('rigid body')[1])]}}
        result=map_records(s,t,item,records)
        assert result['accuracy']=='phrase'
        assert result['geometry']['rects'][0][1]>150
        reverse={'origin':'zh','selectedText':'刚体','zh':result['geometry']}
        restored=map_records(t,s,reverse,records)
        assert restored['geometry']['rects'][0][1]>150
        assert restored['geometry']['rects'][0][2]-restored['geometry']['rects'][0][0]<65


def test_nonmatching_selection_is_not_replaced_by_whole_paragraph():
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        s.insert_text((50,80),'One sentence.',fontsize=12)
        t.insert_text((50,80),'一句话。',fontname='china-s',fontsize=12)
        item={'origin':'en','selectedText':'missing','en':{'rects':[[50,65,120,84]]}}
        assert map_records(s,t,item,[{'source':'One sentence.','target':'一句话。','terms':[]}]) is None


def test_remapping_anchor_excludes_adjacent_line_without_selected_text():
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        s.insert_text((50,80),'Gradient descent',fontsize=12)
        s.insert_text((50,94),'Another line.',fontsize=12)
        t.insert_text((50,80),'梯度下降',fontname='china-s',fontsize=12)
        rect=list(s.search_for('Gradient descent')[0])
        item={'origin':'en','en':{'rects':[rect]}}
        record={'source':'Gradient descent','target':'梯度下降','terms':[['Gradient descent','梯度下降']]}
        result=map_records(s,t,item,[record])
        assert result and result['accuracy']=='phrase'
        assert len(result['geometry']['rects'])==1
