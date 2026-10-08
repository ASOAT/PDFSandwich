"""Original vector cover pages for public product screenshots."""
from pathlib import Path
import math
import pymupdf as fitz
root=Path('tmp/gallery');root.mkdir(parents=True,exist_ok=True)
titles=[('Optimal Control','Models and constraints',(0.25,0.35,0.48)),('Machine Learning','Notes on representation',(0.53,0.42,0.5)),('Robotics','Geometry and motion',(0.35,0.46,0.43)),('Numerical Methods','A practical reading notebook',(0.58,0.46,0.31)),('Research Notebook','Questions and observations',(0.45,0.43,0.55))]
for index,(title,subtitle,color) in enumerate(titles):
 d=fitz.open();p=d.new_page(width=595,height=842)
 p.draw_rect(p.rect,fill=(.97,.96,.94),color=None)
 p.insert_text((48,55),'PDFSANDWICH  /  EXAMPLE LIBRARY',fontsize=9,color=color)
 p.draw_line((48,78),(547,78),color=color,width=.5)
 p.insert_text((48,155),title,fontsize=32,fontname='tibo',color=color)
 p.insert_text((49,188),subtitle,fontsize=14,fontname='tiit',color=color)
 for i in range(9):
  x=295+math.cos(i*.3+index)*65;y=420+math.sin(i*.3+index)*52
  p.draw_circle((x,y),90+i*6,color=tuple(v+(1-v)*.32 for v in color),width=.7)
 p.draw_rect(fitz.Rect(48,678,75,707),fill=color,color=None)
 p.insert_text((92,699),f'READING SERIES   /   {index+1:02}',fontsize=11,color=color)
 p.insert_text((48,774),'Original demonstration content / PDFSandwich Examples',fontsize=9,color=color)
 p=d.new_page();p.insert_text((55,95),title,fontsize=24,fontname='tibo');p.insert_textbox(fitz.Rect(55,140,540,500),'This is an original demonstration document for the PDFSandwich library. Use categories and tags to organize your reading. Add observations to the associated Markdown note.',fontsize=12)
 d.set_metadata({'title':title,'author':'PDFSandwich Examples'});d.save(root/f'cover-{index+1}.pdf');d.close()
