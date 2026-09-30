"""Original bilingual multi-page fixture; no translation service needed."""
from pathlib import Path
import json
import pymupdf as fitz

root=Path('tmp/pdfs/annotation-fixture');root.mkdir(parents=True,exist_ok=True)
source=fitz.open()
for index in range(6):
    en=source.new_page(width=480,height=640)
    target=fitz.open();zh=target.new_page(width=480,height=640)
    records=[
        {'source':f'Training notes {index+1}','target':f'训练笔记 {index+1}','terms':[]},
        {'source':'A neural network learns useful patterns from many training examples.',
         'target':'神经网络从大量训练样本中学习有用的模式。','terms':[['neural network','神经网络']]},
        {'source':'Each layer transforms its inputs and produces new features. These features help the system make better predictions.',
         'target':'每一层转换输入并产生新的特征。这些特征帮助系统作出更好的预测。','terms':[]},
        {'source':'Gradient descent adjusts the model parameters. The learning rate controls how far the parameters move at every optimization step. Evaluation uses examples that were not included in training.',
         'target':'梯度下降调整模型参数。学习率控制每一步优化中参数移动的距离。评估使用未参与训练的样本。','terms':[['Gradient descent','梯度下降']]}]
    en.insert_text((45,65),records[0]['source'],fontname='hebo',fontsize=18)
    zh.insert_text((45,65),records[0]['target'],fontname='china-s',fontsize=18)
    for page,key,font in [(en,'source','helv'),(zh,'target','china-s')]:
        assert page.insert_textbox(fitz.Rect(45,105,405,300),' '.join(r[key] for r in records[1:3]),fontname=font,fontsize=13)>=0
        assert page.insert_textbox(fitz.Rect(45,320,405,560),records[3][key],fontname=font,fontsize=13)>=0
    folder=root/str(index);folder.mkdir(exist_ok=True)
    target.save(folder/'zh.pdf');target.close()
    (folder/'alignment.json').write_text(json.dumps(records,ensure_ascii=False),encoding='utf-8')
source.save(root/'source.pdf');source.close()
print('Created 6-page bilingual annotation fixture.')
