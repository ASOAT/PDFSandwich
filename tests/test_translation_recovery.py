import json
import sys
from pathlib import Path
import pytest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from cancellation import PageCancelled
from text_engine import TextEngine
from translation_quality import translation_problem, translation_units


def engine_at(folder):
    return TextEngine({'modelDir':str(folder),'cancelFile':str(folder/'cancel'),
                      'settings':{'provider':'api','baseUrl':'http://localhost','model':'mock'}},lambda _:None)


def test_formula_loss_repairs_only_fragments_and_keeps_formula_identity(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    def generate(source):
        calls.append(source)
        return '机器人使用矩阵。' if '{v' in source else '机器人使用矩阵' if 'robot' in source else '进行计算。'
    engine.generate=generate
    try:
        text='The robot uses matrix {v12} to calculate.'
        output=engine.translate(text)
        assert output=='机器人使用矩阵 {v12} 进行计算。'
        assert not engine.warnings and engine.repaired==1
        assert len(calls)==3 and all('{v' not in x for x in calls[1:])
        assert engine.translate(text)==output and len(calls)==3
        assert engine.records[-1]['source']==text
    finally:engine.close()


def test_failed_fragment_does_not_discard_successful_translation_or_cache_failure(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    def generate(source):
        calls.append(source)
        return '坏文'*100 if 'broken' in source else '有效译文。'
    engine.generate=generate
    try:
        source='Good sentence {v0} broken sentence'
        output=engine.translate(source)
        assert '有效译文' in output and '{v0}' in output and 'broken sentence' in output
        assert len(engine.warnings)==1 and engine.warnings[0]['source']=='broken sentence'
        assert all(json.loads(row[0])['text']!=output for row in engine.memory.execute('SELECT value FROM translations'))
    finally:engine.close()


def test_long_paragraph_yields_and_resumes_completed_segments_from_cache(tmp_path):
    engine=engine_at(tmp_path)
    source=('A robot moves along the assembly line. '*40).strip()
    units=translation_units(source);assert len(units)>1
    calls=[]
    def generate(part):
        calls.append(part);(tmp_path/'cancel').touch();return '机器人沿着装配线移动。'
    engine.generate=generate
    try:
        with pytest.raises(PageCancelled):engine.translate(source)
        assert len(calls)==1 and not engine.errors and not engine.warnings
        (tmp_path/'cancel').unlink()
        engine.generate=lambda part:'机器人沿着装配线移动。'
        assert '机器人' in engine.translate(source)
        assert engine.hits>=1
    finally:engine.close()


def test_formula_whitespace_and_untranslated_prose_detection():
    assert translation_problem('See {v12}.','参见 { v 12 }。') is None
    assert translation_problem('This robot moves along an assembly line in a factory.', 'This robot moves along an assembly line in a factory.')=='正文仍为英文'
    text=('The matrix is { v 123 } and the model is stable. '*25).strip()
    units=translation_units(text,100)
    assert ''.join(units)==text
    assert all(len(unit)<=100 for unit in units)
    assert sum(unit.count('{ v 123 }') for unit in units)==25


def test_style_markup_is_never_sent_to_model_and_alignment_contains_visible_text(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    def generate(source):
        calls.append(source)
        if source=='Important.':return '重要'
        return source.replace('Read ', '阅读').replace(' now.', '。')
    engine.generate=generate
    try:
        output=engine.translate("Read <style id='1'>Important.</style> now.")
        assert "<style id='1'>重要。</style>" in output
        assert all('<style' not in call for call in calls)
        assert '<style' not in engine.records[-1]['source']
        assert '<style' not in engine.records[-1]['target']
    finally:engine.close()


def test_styled_noun_keeps_its_article_and_rejects_extra_placeholder_braces(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    def generate(source):
        calls.append(source)
        if source=='A nominal solver':return '名义求解器'
        return source.replace(' works.', '进行计算。')
    engine.generate=generate
    try:
        output=engine.translate("A <style id='1'>nominal solver</style> works.")
        assert output=="<style id='1'>名义求解器</style>进行计算。"
        assert calls[0]=='A nominal solver' and calls[1]=='{v1} works.'
        assert translation_problem('A {v1} works.', '一个{{v1}}进行计算。')
        assert translation_problem('The set {{v1}}.', '集合{{v1}}。') is None
    finally:engine.close()


def test_reference_translates_title_but_preserves_authors_venue_and_date(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda source:(calls.append(source) or '贝叶斯优化教程')
    try:
        source='Peter I. Frazier. A Tutorial on Bayesian Optimization, July 2018.'
        output=engine.translate('\x1ereference\x1f'+source)
        assert output=='Peter I. Frazier. 贝叶斯优化教程, July 2018.'
        assert calls==['A Tutorial on Bayesian Optimization']
        assert engine.records[-1]['source']==source
    finally:engine.close()


def test_multicolor_citations_keep_names_years_parentheses_and_sentence_boundary(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda text:(calls.append(text) or text.replace('We use ', '我们使用').replace(' Next sentence.', '下一句。'))
    source="We use {v9} (<style id='1'>Peng & Mohseni</style>, <style id='2'>2016</style>; <style id='3'>Sharma et al.</style>, 2023). Next sentence."
    try:
        output=engine.translate(source)
        assert "(<style id='1'>Peng & Mohseni</style>, <style id='2'>2016</style>; <style id='3'>Sharma et al.</style>, 2023)." in output
        assert all('Mohseni' not in s and 'Sharma' not in s and '<style' not in s for s in calls)
        assert '{v9}' in output and '下一句' in output
        assert 'Peng & Mohseni' in engine.records[-1]['target'] and '<style' not in engine.records[-1]['target']
    finally:engine.close()


def test_citation_continued_from_previous_column_and_unmatched_brackets_are_preserved(tmp_path):
    engine=engine_at(tmp_path)
    engine.generate=lambda text:text.replace(' Note that ', ' 注意，').replace('the model works', '模型有效')
    source="<style id='1'>et al.</style>, <style id='2'>2024</style>, Lemma 5.13). Note that the model works"
    try:
        output=engine.translate(source)
        assert output.startswith("<style id='1'>et al.</style>, <style id='2'>2024</style>, Lemma 5.13). ")
        assert '注意' in output
        assert engine.translate('the model works (Smith').count('(')==1
        assert engine.translate('the model works (Buchfink').endswith('(Buchfink')
    finally:engine.close()


def test_nested_parentheses_translate_content_but_do_not_drop_brackets_or_formulas(tmp_path):
    engine=engine_at(tmp_path)
    engine.generate=lambda text:text.replace('A model ', '模型').replace('stable map ', '稳定映射').replace(' works.', '有效。')
    try:
        output=engine.translate('A model (stable map [{v4}]) works.')
        assert '(稳定映射[{v4}])' in output and output.count('(')==output.count(')')==1
    finally:engine.close()


def test_brackets_crossing_style_boundary_do_not_send_markup_to_model(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda text:(calls.append(text) or text.replace('method','方法').replace('detail','细节'))
    try:
        output=engine.translate("<style id='1'>method (detail</style> ends)")
        assert output.count('(')==output.count(')')==1
        assert "<style id='1'>" in output and '</style>' in output
        assert all('<style' not in s and '</style>' not in s for s in calls)
    finally:engine.close()


def test_citation_punctuation_in_separate_color_runs_preserves_metadata(tmp_path):
    from translation_structure import visible
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda text:(calls.append(text) or text.replace('The method works.', '方法有效。'))
    source="<style id='1'>(</style><style id='3'>Peng & Mohseni</style><style id='5'>, </style><style id='7'>2016</style><style id='9'>). The method works.</style>"
    try:
        output=engine.translate(source)
        assert visible(output).startswith('(Peng & Mohseni, 2016).') and '方法有效' in output
        assert all('Mohseni' not in text and '<style' not in text for text in calls)
        assert output.count('<style ')==output.count('</style>')
        source="<style id='1'>et al.</style><style id='3'>, 2024</style><style id='5'>, Lemma 5.13). The method works.</style>"
        output=engine.translate(source)
        assert visible(output).startswith('et al., 2024, Lemma 5.13).') and '方法有效' in output
    finally:engine.close()
