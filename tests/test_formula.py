import sys
from pathlib import Path
import numpy as np
import pytest
from PIL import Image, ImageDraw
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from formula_pp import preprocess, decode


def test_formula_image_keeps_entire_matrix_and_has_bounded_resolution():
    im=Image.new('RGB',(1200,800),'white');d=ImageDraw.Draw(im)
    for x in (50,550,1050):
        for y in (50,350,650):d.rectangle((x,y,x+40,y+40),fill='black')
    array=preprocess(im)
    assert array.shape==(1,1,768,768) and array.dtype==np.float32
    # All three separated matrix columns and rows survive letterboxing.
    ink=array[0,0]<-3
    for profile in (ink[384,:],ink[:,384]):
        assert np.count_nonzero(np.diff(np.pad(profile.astype(int),(1,1)))==1)==3
    with pytest.raises(ValueError):preprocess(Image.new('RGB',(200,200),'white'))


def test_latex_preserves_cells_and_indices_rejects_truncated_prediction():
    class Tokenizer:
        def decode(self,values,skip_special_tokens):
            return r'\begin{align*}x_i&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\end{align*}'
    text=decode([0,3,4,2,1],Tokenizer())
    assert text==r'\begin{aligned}x_i&=\begin{pmatrix}1&2\\3&4\end{pmatrix}\end{aligned}'
    with pytest.raises(ValueError):decode([0,3,4],Tokenizer())
