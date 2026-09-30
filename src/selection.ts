import { mergeRects, transformRect } from './geometry';
import type { Document as PdfDocument, Mark, Rect, Side } from './types';

const surfaceOf=(node:Node)=> (node.nodeType===Node.ELEMENT_NODE?node as Element:node.parentElement)?.closest<HTMLElement>('.pdf-surface');

export function selectionMarks(container: HTMLElement, range: Range, doc: PdfDocument, side: Side, scale: number, kind: 'highlight'|'underline', color: string): Mark[] {
  const first=surfaceOf(range.startContainer),last=surfaceOf(range.endContainer);
  if(!first||!last||!container.contains(first)||!container.contains(last))return [];
  const start=Number(first.dataset.page)-1,end=Number(last.dataset.page)-1;
  const marks:Mark[]=[];
  for(let page=start;page<=end;page++){
    const common={id:crypto.randomUUID(),page,kind,color,width:1.6,content:'',origin:side,accuracy:'pending'};
    // Intermediate pages may be virtualized. Their full text geometry is read
    // by the backend, without rendering every selected page or marking images.
    if(page>start&&page<end){marks.push({...common,wholePage:true});continue;}
    const surface=page===start?first:last,layer=surface.querySelector('.textLayer');
    if(!layer)continue;
    const bounds=surface.getBoundingClientRect(),rects:Rect[]=[];
    const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);let node:Node|null;let selectedText='';
    while((node=walker.nextNode())){
      if(!range.intersectsNode(node))continue;
      const part=document.createRange();part.selectNodeContents(node);
      if(range.compareBoundaryPoints(Range.START_TO_START,part)>0)part.setStart(range.startContainer,range.startOffset);
      if(range.compareBoundaryPoints(Range.END_TO_END,part)<0)part.setEnd(range.endContainer,range.endOffset);
      if(part.collapsed)continue;
      selectedText+=part.toString();
      // Text-node ranges omit the duplicate parent-span/marked-content boxes
      // returned by a range that spans several styled PDF.js text elements.
      for(const r of part.getClientRects())if(r.width>1&&r.height>2)rects.push(transformRect([(r.left-bounds.left)/scale,(r.top-bounds.top)/scale,(r.right-bounds.left)/scale,(r.bottom-bounds.top)/scale],doc.pages[page],true));
    }
    const unique=mergeRects(rects);
    if(unique.length)marks.push({...common,[side]:{rects:unique},selectedText});
  }
  return marks;
}
