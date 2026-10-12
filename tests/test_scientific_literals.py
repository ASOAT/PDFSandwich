import sys
from pathlib import Path

import pytest

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from translation_structure import protected_ranges, scientific_literals, visible
from test_translation_recovery import engine_at


@pytest.mark.parametrize('code', ['In1', 'Ab12', 'ResNet50', 'GPT-4o', 'v2.1'])
def test_bracketed_letter_digit_identifiers_are_preserved(code):
    source=f'The model ({code}) is stable.'
    start=source.index('(')
    assert list(protected_ranges(source))==[(start,start+len(code)+2,None)]


@pytest.mark.parametrize('prose', ['In 2025', 'in 1 step', 'Model 2 is stable', 'for all i', 'In1 and In2'])
def test_parenthetical_prose_remains_translatable(prose):
    source=f'The explanation ({prose}) follows.'
    start=source.index('(')
    assert list(protected_ranges(source))==[(start,start+len(prose)+2,prose)]


def test_styled_identifier_never_reaches_translation_model(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    code="In<style id='2'>1</style>"
    source=f'The model ({code}) is stable.'
    def generate(text):
        calls.append(text)
        return text.replace('The model ', '模型').replace(' is stable.', '稳定。').replace('In1', '在1中')
    engine.generate=generate
    try:
        output=engine.translate(source)
        assert visible(output)=='模型(In1)稳定。'
        assert "<style id='2'>1</style>" in output
        assert all('In1' not in text and '<style' not in text for text in calls)
        assert engine.records[-1]['target']=='模型(In1)稳定。'
    finally:engine.close()


def test_code_protection_composes_with_figure_labels_and_formula_tokens(tmp_path):
    engine=engine_at(tmp_path);calls=[]
    engine.generate=lambda text:(calls.append(text) or text.replace('Results for ', '结果对应').replace(' and ', '和'))
    source='Fig. 2 Results for (Ab12) and {v9}.'
    try:
        output=engine.translate(source)
        assert output=='图 2 结果对应(Ab12)和{v9}.'
        assert all('Ab12' not in text for text in calls)
        assert '{v9}' in output
        assert scientific_literals('(Smith, 2024, Section 2)')==[]
    finally:engine.close()
