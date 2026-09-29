"""Inspect actual glyph matches after quality-benchmark.py (local samples only)."""
import json
import sys
from pathlib import Path
import pymupdf as fitz
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from annotation_alignment import map_records,glyphs,locate,boxes

CASES={
    'contents':[('Nonholonomic','非完整'),('rotation matrices','旋转矩阵'),('Rotational velocity','角速度'),('Wrenches','力旋量')],
    'body':[('science fiction','科幻'),('printed circuit boards','印刷电路板'),('nuclear','核'),('biological motor control systems','生物运动控制系统')],
    'formulas':[('rigid body','刚体'),('cross product','叉积')],
}

def main():
    report=[]
    for name,phrases in CASES.items():
        records=json.loads(Path(f'tmp/quality-benchmark/new-{name}-alignment.json').read_text(encoding='utf-8'))
        with fitz.open(f'tmp/quality-benchmark/{name}.pdf') as src,fitz.open(f'tmp/quality-benchmark/new-{name}.pdf') as dst:
            text,chars=glyphs(src[0]);_,target_chars=glyphs(dst[0])
            for phrase,expected in phrases:
                hits=locate(text,chars,phrase)
                assert hits, f'Source sample missing: {phrase}'
                item={'origin':'en','selectedText':phrase,'en':{'rects':boxes(hits[0])}}
                result=map_records(src[0],dst[0],item,records)
                found=''
                if result:
                    for rect in result['geometry']['rects']:
                        seen=set()
                        for char in target_chars:
                            key=tuple(char['bbox']);box=fitz.Rect(key);center=(box.tl+box.br)*.5
                            if key not in seen and fitz.Rect(rect).contains(center):found+=char['c'];seen.add(key)
                report.append({'page':name,'phrase':phrase,'expectedConcept':expected,'mapped':found,'conceptPresent':expected in found})
    Path('test-results/precision-concepts.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    for item in report:print(json.dumps(item,ensure_ascii=False))
    # Concept presence is a diagnostic, not a claim of exact semantic accuracy.
    print(json.dumps({'conceptsPresent':sum(r['conceptPresent'] for r in report),'cases':len(report)}))

if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8');main()
