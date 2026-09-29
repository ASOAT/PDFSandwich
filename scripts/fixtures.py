"""Generate original test documents; no private or copyrighted input is used."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit
import pymupdf

DEST = Path(__file__).resolve().parents[1] / "tmp" / "pdfs"
DEST.mkdir(parents=True, exist_ok=True)
sample = DEST / "reading-sample.pdf"
c = canvas.Canvas(str(sample), pagesize=(595,842), pageCompression=1)
for number in range(6):
    c.setFillColorRGB(.17,.27,.24)
    c.setFont("Helvetica",9);c.drawString(50,802,"PDFSANDWICH / READING LAB")
    c.setFont("Times-Bold",24);c.drawString(50,750,"Understanding scientific ideas")
    c.bookmarkPage(f"p{number}");c.addOutlineEntry(f"Chapter {number+1}: Learning from evidence",f"p{number}",0)
    c.setFont("Times-Roman",12)
    paragraphs=[
      "Scientific knowledge grows when observations are connected to clear explanations. A useful model describes a system, makes predictions, and helps us understand why a result occurs.",
      "Reading in two languages can make difficult ideas easier to understand. Compare the original paragraph with its translation, and mark the concepts that need further thought.",
      "An annotation records a reader's question without changing the author's words. Highlights, underlines, and handwritten notes should remain attached to the relevant passage when the document is opened again.",
      "The equation below relates mass and energy. Mathematical symbols and visual diagrams should retain their original appearance in a translated document."]
    y=706
    for paragraph in paragraphs:
        for line in simpleSplit(paragraph,"Times-Roman",12,490): c.drawString(50,y,line);y-=18
        y-=16
    c.setFont("Times-Italic",19);c.drawCentredString(297,410,"E = mc")
    c.setFont("Times-Roman",11);c.drawString(329,420,"2")
    c.setStrokeColorRGB(.28,.45,.34);c.setFillColorRGB(.9,.94,.87)
    c.roundRect(65,205,465,150,8,stroke=1,fill=1)
    c.line(105,235,105,328);c.line(105,235,490,235)
    c.setStrokeColorRGB(.25,.56,.39);c.setLineWidth(2)
    p=c.beginPath();p.moveTo(110,240);p.curveTo(215,244,360,270,485,320);c.drawPath(p)
    c.setFont("Helvetica",10);c.setFillColorRGB(.3,.4,.27);c.drawString(119,325,"A conceptual relationship")
    c.setFont("Times-Italic",10);c.drawString(65,181,"Figure 1. A vector diagram retained during translation.")
    c.setFont("Times-Roman",10);c.drawString(50,115,"This document was generated for testing. It contains no third-party material.")
    c.setFont("Helvetica",9);c.drawRightString(540,42,str(number+1));c.showPage()
c.save()
with pymupdf.open(sample) as d:
    d[1].set_rotation(90)
    d.save(DEST/"rotated-sample.pdf")
with pymupdf.open(sample) as source, pymupdf.open() as d:
    for i in range(1000):
        d.insert_pdf(source,from_page=i%6,to_page=i%6)
    d.save(DEST/"large-1000-pages.pdf",garbage=3,deflate=True)
print("Created 6-page, rotated-page, and 1000-page fixtures.")
