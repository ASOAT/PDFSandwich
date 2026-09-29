"""Apply two recorded import substitutions to the pinned BabelDOC dependency.

Only build/development setup calls this script. The installed application never
edits its dependencies. The original layout algorithms and defaults stay intact.
"""
import importlib.metadata
from pathlib import Path
import sys

if importlib.metadata.version('babeldoc')!='0.6.2':
    raise RuntimeError('Review the page-math patch before changing BabelDOC version')
root=Path(sys.prefix)/'Lib/site-packages/babeldoc/format/pdf/document_il'
patches=[('utils/extract_char.py','from sklearn.cluster import DBSCAN','from pdfsandwich_layout_math import DBSCAN'),
         ('midend/detect_scanned_file.py','from skimage.metrics import structural_similarity','from pdfsandwich_layout_math import structural_similarity')]
for relative,before,after in patches:
    file=root/relative;text=file.read_text(encoding='utf-8')
    if after in text:continue
    if text.count(before)!=1:raise RuntimeError(f'Unexpected upstream file: {relative}')
    file.write_text(text.replace(before,after),encoding='utf-8')
print('Pinned BabelDOC page-math imports verified.')
