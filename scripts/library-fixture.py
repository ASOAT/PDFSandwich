"""Original, synthetic documents for the library and automatic-save UI checks."""
import sys
from pathlib import Path
import pymupdf as fitz
directory=Path(sys.argv[1]);directory.mkdir(parents=True,exist_ok=True)
titles=['Optimal Control Notes','Introduction to Machine Learning','Robotics Reading List']
for index,title in enumerate(titles):
    with fitz.open() as doc:
        doc.set_metadata({'title':title,'author':'PDFSandwich Examples'})
        for number in range(3):
            page=doc.new_page()
            page.insert_text((55,80),title,fontsize=23)
            page.insert_text((55,125),f'Original page {number+1}. A synthetic reading example.',fontsize=12)
            page.insert_text((55,165),'A model describes the system. Constraints define the feasible set.',fontsize=12)
        doc.set_toc([[1,'Introduction',1],[1,'Examples',2]]);doc.save(directory/f'example-{index+1}.pdf')
with fitz.open() as doc:
    page=doc.new_page();page.insert_text((55,80),'最优控制笔记',fontname='china-s',fontsize=23)
    page.insert_text((55,125),'这是用于验证文献库与自动保存的示例译文。',fontname='china-s',fontsize=12)
    page.insert_text((55,165),'模型描述系统，约束定义可行域。',fontname='china-s',fontsize=12)
    doc.save(directory/'translated-page.pdf')
