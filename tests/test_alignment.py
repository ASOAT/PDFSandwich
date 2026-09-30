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


def test_long_selection_spans_records_wrapped_lines_and_repeated_ranges():
    from annotation_alignment import glyphs, boxes, coverage
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        records=[
            {'source':'A neural network learns useful patterns from many training examples. Each layer transforms its inputs and produces new features.',
             'target':'神经网络从大量训练样本中学习有用的模式。每一层转换输入并产生新的特征。','terms':[]},
            {'source':'Gradient descent adjusts the model parameters. The learning rate controls how far the parameters move at every optimization step.',
             'target':'梯度下降调整模型参数。学习率控制每一步优化中参数移动的距离。','terms':[]}]
        for i,record in enumerate(records):
            y=60+i*160
            assert s.insert_textbox(fitz.Rect(50,y,290,y+140),record['source'],fontsize=12)>=0
            assert t.insert_textbox(fitz.Rect(50,y,290,y+140),record['target'],fontname='china-s',fontsize=12)>=0
        _,source_chars=glyphs(s);_,target_chars=glyphs(t)
        item={'origin':'en','selectedText':' '.join(r['source'] for r in records),'en':{'rects':boxes(source_chars)}}
        result=map_records(s,t,item,records+[records[0]])
        assert result and len(result['geometry']['rects'])>=4
        rectangles=[fitz.Rect(r) for r in result['geometry']['rects']]
        assert coverage(target_chars,rectangles)>.99
        assert all((a&b).get_area()<.05 for i,a in enumerate(rectangles) for b in rectangles[i+1:])
        reverse={'origin':'zh','selectedText':''.join(r['target'] for r in records),'zh':result['geometry']}
        restored=map_records(t,s,reverse,records)
        assert coverage(source_chars,[fitz.Rect(r) for r in restored['geometry']['rects']])>.99


def test_complete_sentences_map_without_attention_even_inside_long_record():
    record={'source':'First sentence describes training. Second sentence explains evaluation. Third sentence is outside.',
            'target':'第一句描述训练。第二句解释评估。第三句不在选区中。','terms':[]}
    end=record['source'].index(' Third')
    ranges=aligned_ranges(record,0,end,'en')
    assert ''.join(record['target'][a:b] for a,b in ranges)=='第一句描述训练。第二句解释评估。'
    # A short unknown phrase must still not expand into an entire sentence.
    assert aligned_ranges(record,6,14,'en')==[]


def test_merge_rectangles_removes_overlap_without_joining_adjacent_lines_or_gaps():
    from annotation_alignment import merge_rects
    source=[[0,0,30,12],[20,.2,50,12.2],[0,0,30,12],[0,14,50,26],[65,0,80,12]]
    result=merge_rects(source)
    assert len(result)==3
    assert result[0]==[0,0,50,12.2]
    assert any(r[0]==65 for r in result)
    assert any(r[1]==14 for r in result)


def test_record_chain_does_not_consume_later_periods_or_repeated_first_word():
    from annotation_alignment import record_instances
    text = compact('Take x and y. Take a and b. Later text.')
    paths = record_instances(text, 'Take {v1} and {v2}.')
    assert [(p[0][2], p[-1][3]) for p in paths] == [(0, 10), (10, 20)]
    assert compact('甲\x03乙') == '甲乙'


def test_two_column_math_and_short_connectors_stay_with_their_paragraph():
    from annotation_alignment import glyphs, boxes, coverage
    # All data here is synthetic. Repeated "and let"/"and" and a standalone
    # final period reproduce the two independent sources of cross-block marks.
    rows = [
        (45, 55, 'The preceding paragraph cites {v1}.', '上一段引用{v1}。', {'{v1}': '(1)'}),
        (45, 140, 'The solver minimizes a smooth objective {v1} under a constraint:',
         '求解器在约束下最小化光滑目标{v1}：', {'{v1}': 'f(x)'}),
        (320, 55, 'Choose a target value {v1} and let {v2} converge to {v3}.',
         '选择目标值{v1}，并让{v2}收敛到{v3}。', {'{v1}': 'a=0', '{v2}': 'x', '{v3}': 'a'}),
        (320, 330, 'Another theorem assumes {v1} and let {v2} and {v3} remain fixed.',
         '另一定理假设{v1}并且让{v2}和{v3}保持不变。', {'{v1}': 'b=1', '{v2}': 'y', '{v3}': 'b'}),
    ]
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page(width=620);t=dst.new_page(width=620)
        records=[]
        for x,y,en,zh,formulas in rows:
            records.append({'source':en,'target':zh,'terms':[]})
            for marker,value in formulas.items():
                en=en.replace(marker,value);zh=zh.replace(marker,value)
            assert s.insert_textbox(fitz.Rect(x,y,x+240,y+100),en,fontsize=11)>=0
            assert t.insert_textbox(fitz.Rect(x,y,x+240,y+100),zh,fontname='china-s',fontsize=11)>=0
        # Display equations have no translation record at all.
        for p in (s,t):
            p.insert_text((60,225),'x + y = 0, (2a)',fontsize=11)
            p.insert_text((60,245),'a + b = 1, (2b)',fontsize=11)
        for origin,page,other in [('en',s,t),('zh',t,s)]:
            _,chars=glyphs(page);_,opposite=glyphs(other)
            for region in (fitz.Rect(40,130,300,260),fitz.Rect(310,45,570,130)):
                chosen=[c for c in chars if region.contains(fitz.Rect(c['bbox']))]
                expected=[c for c in opposite if region.contains(fitz.Rect(c['bbox']))]
                item={'origin':origin,origin:{'rects':boxes(chosen)}}
                result=map_records(page,other,item,records)
                rects=[fitz.Rect(r) for r in result['geometry']['rects']]
                assert rects and all(region.contains(r) for r in rects)
                assert coverage(expected,rects)>.99
                assert all((a&b).get_area()<.05 for i,a in enumerate(rects) for b in rects[i+1:])
            # A single mathematical symbol maps via its preserved equation,
            # rather than to another occurrence of x in translated prose.
            selected=page.search_for('x + y')[0]
            item={'origin':origin,'selectedText':'x + y',origin:{'rects':[list(selected)]}}
            result=map_records(page,other,item,records)
            assert result and all(210<r[1]<230 for r in result['geometry']['rects'])


def test_table_names_do_not_claim_repeated_occurrences_inside_a_paragraph():
    from annotation_alignment import glyphs, boxes, coverage
    with fitz.open() as src,fitz.open() as dst:
        s=src.new_page();t=dst.new_page()
        english=['The results are provided by engine.core.',
                 'Another engine.core run gives different results.']
        chinese=['结果由engine.core提供。', '另一次engine.core运行得到不同结果。']
        # Reflow moves the first target name left. Its second occurrence is
        # closer to the original name's coordinates, but is not its counterpart.
        for page in (s,t):page.insert_text((60,65),'engine.core',fontsize=12)
        for i,(en,zh) in enumerate(zip(english,chinese)):
            s.insert_text((60,160+i*30),en,fontsize=12)
            t.insert_text((60+i*125,160+i*30),zh,fontname='china-s',fontsize=12)
        records=[{'source':' '.join(english),'target':''.join(chinese),'terms':[]},
                 {'source':'engine.core','target':'engine.core','terms':[]},
                 {'source':'engine.core','target':'engine.core','terms':[]}]
        for origin,page,other in [('en',s,t),('zh',t,s)]:
            _,chars=glyphs(page);_,opposite=glyphs(other)
            for y in (65,160,190):
                chosen=[c for c in chars if abs(c['origin'][1]-y)<1]
                expected=[c for c in opposite if abs(c['origin'][1]-y)<1]
                item={'origin':origin,origin:{'rects':boxes(chosen)}}
                result=map_records(page,other,item,records)
                assert result
                rects=[fitz.Rect(r) for r in result['geometry']['rects']]
                assert coverage(expected,rects)>.99
                assert all(y-16<r.y0<y+1 for r in rects)
            # Single-name selections also follow their occurrence in the owned
            # paragraph, even when there are no attention links to consult.
            hits=page.search_for('engine.core')
            assert len(hits)==3
            for hit in hits:
                item={'origin':origin,'selectedText':'engine.core',origin:{'rects':[list(hit)]}}
                result=map_records(page,other,item,records)
                assert result and len(result['geometry']['rects'])==1
                assert abs(result['geometry']['rects'][0][1]-hit.y0)<5
