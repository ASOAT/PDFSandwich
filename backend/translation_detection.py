"""Cheap text-layer checks; never import a translation model or run OCR."""
import re


def page_kind(page):
    text=page.get_text('text')[:100000]
    chinese=len(re.findall(r'[\u3400-\u9fff]',text))
    words=re.findall(r'[A-Za-z]{2,}',text)
    letters=sum(map(len,words))
    # English titles, acronyms and a bilingual abstract do not make a Chinese
    # article an English document. Count words, rather than individual letters.
    if chinese>=20 and chinese>=len(words)*1.5:
        return 'chinese'
    if len(words)>=10 and letters>=45 and text.count('\ufffd')<letters*.25:
        return 'english'
    if chinese>=5 and not words:
        return 'chinese'
    # Sparse selectable headers/page numbers can sit on a full-page scan.
    # get_image_info reads metadata without decoding/rendering the image.
    import pymupdf as fitz
    area=max(1,page.rect.get_area())
    coverage=sum((fitz.Rect(image['bbox']) & page.rect).get_area() for image in page.get_image_info())/area
    if coverage>=.5:
        return 'needs-ocr'
    if not chinese and letters<3:
        return 'no-text'
    return 'unknown'


def document_profile(document):
    count=len(document)
    # Bound startup work for large books, and look beyond a cover/abstract.
    indices=sorted(set(range(min(count,5))) | {round(i*(count-1)/10) for i in range(11)}) if count else []
    pages={i:page_kind(document[i]) for i in indices}
    kinds=list(pages.values())
    chinese=kinds.count('chinese');english=kinds.count('english')
    if chinese and chinese>=english*3:
        kind='chinese'
    elif english:
        kind='english'
    elif 'needs-ocr' in kinds:
        kind='needs-ocr'
    elif kinds and all(k=='no-text' for k in kinds):
        kind='no-text'
    else:
        kind='unknown'
    return {'kind':kind,'sampledPages':len(indices)},pages
