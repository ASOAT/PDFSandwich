"""1000 pages / ~95 MiB, each with unique incompressible image content."""
from pathlib import Path
import random
import pymupdf
root = Path(__file__).resolve().parents[1]
destination = root/'tmp/pdfs/stress-1000-pages.pdf'
randomizer = random.Random(928)
with pymupdf.open(root/'tmp/pdfs/reading-sample.pdf') as source, pymupdf.open() as doc:
    for number in range(1000):
        doc.insert_pdf(source, from_page=number % 6, to_page=number % 6, annots=False)
        pixels = pymupdf.Pixmap(pymupdf.csRGB, 180, 180, randomizer.randbytes(180*180*3), False)
        doc[-1].insert_image((440,640,530,730), pixmap=pixels)
    doc.save(destination)
print(f'{len(pymupdf.open(destination))} pages / {destination.stat().st_size/1048576:.1f} MiB')
