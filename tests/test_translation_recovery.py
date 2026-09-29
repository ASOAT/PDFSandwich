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
