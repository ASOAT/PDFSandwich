"""Create an original, redistributable reading sample for release/UI checks."""
from pathlib import Path
import pymupdf as fitz

out=Path('tmp/pdfs');out.mkdir(parents=True,exist_ok=True)
doc=fitz.open();page=doc.new_page(width=595,height=842)
green=(.16,.34,.25);ink=(.14,.18,.16);muted=(.4,.46,.42)
page.insert_text((55,48),'PDFSANDWICH  /  READING SAMPLE',fontsize=8,color=muted)
page.draw_line((55,63),(540,63),color=(.79,.84,.77),width=.7)
page.insert_text((55,113),'Learning from data',fontname='tibo',fontsize=29,color=ink)
page.insert_text((56,143),'A short introduction to neural networks',fontname='tiit',fontsize=12,color=muted)
page.insert_text((55,191),'1   Neural networks',fontname='tibo',fontsize=15,color=green)
page.insert_textbox(fitz.Rect(55,211,540,300),
    'A neural network learns patterns from data. Each layer combines its inputs '
    'and passes the result to the next layer. During training, the model adjusts '
    'its parameters to reduce the difference between its predictions and the expected outputs.',
    fontname='tiro',fontsize=12,color=ink,lineheight=1.45)

for x,ys in [(150,[328,359,390]),(295,[314,344,374,404]),(440,[344,374])]:
    next_column=(295,[314,344,374,404]) if x==150 else (440,[344,374]) if x==295 else None
    if next_column:
        for y in ys:
            for ny in next_column[1]:page.draw_line((x,y),(next_column[0],ny),color=(.8,.85,.8),width=.6)
for x,ys in [(150,[328,359,390]),(295,[314,344,374,404]),(440,[344,374])]:
    for y in ys:page.draw_circle((x,y),7,color=green,fill=(.87,.92,.84),width=.8)
page.insert_text((137,434),'Inputs',fontname='tiro',fontsize=10,color=muted)
page.insert_text((267,434),'Hidden layer',fontname='tiro',fontsize=10,color=muted)
page.insert_text((418,434),'Prediction',fontname='tiro',fontsize=10,color=muted)
page.insert_text((55,483),'2   Training and optimization',fontname='tibo',fontsize=15,color=green)
page.insert_htmlbox(fitz.Rect(55,505,540,650),
    '<p><b>Gradient descent</b> updates model parameters in the direction that reduces '
    'the loss function. A smaller learning rate makes each update more cautious. '
    '<i>Regularization helps reduce overfitting.</i> '
    '<span style="color:#b84632">Validation data should remain separate from training data.</span></p>'
    '<p>The objective function measures how well the model fits the observations. '
    'Compare the translated explanation with the original text and mark the terms you want to revisit.</p>',
    css='body{font-family:serif;font-size:12pt;line-height:1.45;color:#243029;margin:0}p{margin:0 0 12pt}')
page.draw_line((55,735),(540,735),color=(.79,.84,.77),width=.7)
page.insert_text((55,756),'Original demonstration content / PDFSandwich contributors',fontsize=8,color=muted)
page.insert_text((532,790),'1',fontname='tiro',fontsize=10,color=muted)
doc.set_metadata({'title':'Learning from data — PDFSandwich sample','author':'PDFSandwich contributors'})
doc.save(out/'release-sample.pdf',garbage=3,deflate=True)
print('Created original release reading sample.')
