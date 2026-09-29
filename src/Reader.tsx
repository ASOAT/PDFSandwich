import { useEffect, useLayoutEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { TextLayer, AnnotationMode, type PDFPageProxy } from 'pdfjs-dist';
import { Languages, LoaderCircle, MessageSquare, RotateCcw } from 'lucide-react';
import { acquirePdf, clearPdfCache } from './pdf';
import { fromView, toView, transformRect, viewSize } from './geometry';
import type { Document, Mark, PageInfo, Point, Rect, Side, Tool, Match } from './types';

export type ReaderHandle = { go: (page: number, fraction?: number) => void; captureZoomAnchor: (x?: number, y?: number) => void };
type Props = { doc: Document; side: Side; zoom: number; tool: Tool; color: string; marks: Mark[]; matches: Match[]; onPosition: (page: number, fraction: number) => void; onWheelZoom: (factor: number, x: number, y: number) => void; onMark: (mark: Mark) => void; onSelectMark: (id: string) => void; onTranslate: (page: number) => void; onError: (message: string) => void };

function PdfPage({ doc, side, page: index, scale, info, tool, color, marks, matches, onMark, onSelectMark, onError }: Omit<Props,'zoom'|'onPosition'|'onTranslate'> & { page: number; scale: number; info: PageInfo }) {
  const canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null), surface = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true), [error, setError] = useState(''), [stroke, setStroke] = useState<Point[]>([]);
  const pen = useRef<Point[]>([]), drawing = useRef(false);
  const url = side === 'en' ? doc.sourceUrl : doc.translations[index]?.url;
  const size = viewSize(info);
  useEffect(() => {
    if (!url) return;
    let cancelled = false, renderTask: { cancel: () => void } | undefined, layer: TextLayer | undefined, pdfPage: PDFPageProxy | undefined;
    const resource = acquirePdf(url); setRendering(true); setError('');
    void resource.promise.then(async pdf => {
      const page = await pdf.getPage(side === 'en' ? index+1 : 1);
      pdfPage = page;
      if (cancelled || !canvas.current || !text.current) { page.cleanup(); return; }
      const viewport = page.getViewport({ scale, rotation: info.rotation });
      const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(12000000 / (viewport.width*viewport.height)));
      const node = canvas.current;
      node.width = Math.floor(viewport.width*ratio); node.height = Math.floor(viewport.height*ratio);
      node.style.width = `${viewport.width}px`; node.style.height = `${viewport.height}px`;
      const task = page.render({ canvas: node, viewport, transform: [ratio,0,0,ratio,0,0], annotationMode: AnnotationMode.DISABLE }); renderTask = task;
      const container = text.current; container.replaceChildren();
      container.style.setProperty('--scale-factor', String(scale)); container.style.setProperty('--total-scale-factor', String(scale));
      layer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport });
      try { await Promise.all([task.promise, layer.render()]); }
      finally { if (cancelled) page.cleanup(); }
      if (!cancelled) setRendering(false);
    }).catch(e => { if (!cancelled && e.name !== 'RenderingCancelledException' && e.name !== 'AbortException') { setError(e.message); setRendering(false); } });
    return () => { cancelled = true; renderTask?.cancel(); layer?.cancel(); pdfPage?.cleanup(); resource.release(); };
  }, [url, index, side, scale, info.rotation]);
  const add = (kind: Mark['kind'], rects: Rect[], paths?: Point[][], selectedText?: string) => onMark({ id: crypto.randomUUID(), page: index, kind, color, width: 1.6, content: '', origin: side, [side]: { rects, ...(paths ? { paths } : {}) }, accuracy: 'pending', selectedText });
  const point = (event: React.PointerEvent): Point => { const bounds = surface.current!.getBoundingClientRect(); return fromView([Math.max(0,Math.min(size[0],(event.clientX-bounds.left)/scale)),Math.max(0,Math.min(size[1],(event.clientY-bounds.top)/scale))],info); };
  const finishSelection = () => {
    if (tool !== 'highlight' && tool !== 'underline') return;
    const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!text.current?.contains(range.startContainer) || !text.current?.contains(range.endContainer)) { onError('请在同一页内选择文字；跨页内容请分别标记。'); return; }
    const bounds = surface.current!.getBoundingClientRect();
    const rects = [...range.getClientRects()].filter(r=>r.width>1 && r.height>2).map(r => transformRect([(r.left-bounds.left)/scale,(r.top-bounds.top)/scale,(r.right-bounds.left)/scale,(r.bottom-bounds.top)/scale],info,true));
    const unique = rects.filter((rect,index)=>rects.findIndex(other=>other.every((value,i)=>Math.abs(value-rect[i])<.1))===index);
    if (unique.length) add(tool, unique, undefined, selection.toString()); selection.removeAllRanges();
  };
  const pathData = (points: Point[]) => points.map((p,i) => { const [x,y] = toView(p,info); return `${i?'L':'M'}${x},${y}`; }).join(' ');
  return <div ref={surface} className={`pdf-surface tool-${tool}`} data-page={index+1} data-side={side} style={{ width: size[0]*scale, height: size[1]*scale }} onMouseUp={finishSelection}
    onPointerDown={e=>{ if (rendering || error) return; if (tool==='ink') { e.preventDefault(); surface.current!.setPointerCapture(e.pointerId); drawing.current=true; pen.current=[point(e)]; setStroke(pen.current); } else if (tool==='note') { e.preventDefault(); const [x,y]=point(e); add('note',[[x,y,x+18,y+18]]); } }}
    onPointerMove={e=>{if(drawing.current){pen.current=[...pen.current,point(e)];setStroke(pen.current);}}}
    onPointerCancel={()=>{drawing.current=false;pen.current=[];setStroke([]);}}
    onPointerUp={e=>{if(drawing.current){drawing.current=false;surface.current!.releasePointerCapture(e.pointerId);const points=pen.current;if(points.length>1){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);add('ink',[[Math.min(...xs),Math.min(...ys),Math.max(...xs)+.1,Math.max(...ys)+.1]],[points]);}pen.current=[];setStroke([]);}}}>
    <canvas ref={canvas}/><div ref={text} className="textLayer"/>
    <svg className="mark-layer" viewBox={`0 0 ${size[0]} ${size[1]}`}>
      {matches.flatMap((match,i)=>match.rects.map((rect,j)=>{const r=transformRect(rect,info);return <rect key={`s${i}-${j}`} x={r[0]} y={r[1]} width={r[2]-r[0]} height={r[3]-r[1]} fill="#ff992e" opacity=".35"/>;}))}
      {marks.map(mark=>{const geo=mark[side];if(!geo)return null;return <g key={mark.id} data-mark-id={mark.id} className={tool==='select'?'mark-clickable':''} onClick={e=>{if(tool==='select'){e.stopPropagation();onSelectMark(mark.id);}}}>
        {mark.kind==='ink'?geo.paths?.map((points,i)=><path key={i} d={pathData(points)} fill="none" stroke={mark.color} strokeWidth={mark.width} strokeLinecap="round" strokeLinejoin="round"/>):geo.rects.map((rect,i)=>{const r=transformRect(rect,info);return mark.kind==='note'?<g key={i} transform={`translate(${r[0]},${r[1]})`}><rect width="18" height="18" rx="4" fill={mark.color}/><path d="M4 5H14M4 9H12M4 13H9" stroke="white" strokeWidth="1.4"/></g>:mark.kind==='underline'?<line key={i} x1={r[0]} x2={r[2]} y1={r[3]-1} y2={r[3]-1} stroke={mark.color} strokeWidth="1.2"/>:<rect key={i} x={r[0]} y={r[1]} width={r[2]-r[0]} height={r[3]-r[1]} fill={mark.color} opacity=".32"/>;})}
      </g>;})}
      {stroke.length>1&&<path d={pathData(stroke)} fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round"/>}
    </svg>
    {rendering&&<div className="page-rendering"><LoaderCircle size={20} className="spin"/></div>}
    {error&&<div className="page-error">此页无法渲染：{error}</div>}
  </div>;
}

export const Reader = forwardRef<ReaderHandle, Props>((props, ref) => {
  const { doc, side, zoom, onPosition, onTranslate } = props;
  const viewport = useRef<HTMLDivElement>(null), ignoredTop=useRef<number|null>(null), restored=useRef('');
  const [width,setWidth]=useState(600),[scrollTop,setScrollTop]=useState(0),[height,setHeight]=useState(800);
  const maxWidth = useMemo(()=>Math.max(...doc.pages.map(p=>viewSize(p)[0])),[doc.id]);
  const scale = Math.max(.2,(width-64)/maxWidth)*zoom;
  const offsets=useMemo(()=>{let top=24;return doc.pages.map(info=>{const value=top;top+=viewSize(info)[1]*scale+40;return value;});},[doc.id,scale]);
  const total=offsets.at(-1)!+viewSize(doc.pages.at(-1)!)[1]*scale+40;
  function indexAt(top:number, positions=offsets) { let low=0,high=positions.length-1;while(low<high){const mid=Math.ceil((low+high)/2);if(positions[mid]<=top)low=mid;else high=mid-1;}return low; }
  const layout=useRef({scale,width,offsets,id:doc.id});
  const zoomAnchor=useRef<{page:number;localX:number;localY:number;x:number;y:number}|null>(null);
  function captureZoomAnchor(x=.5,y=.5,previous=layout.current){
    const node=viewport.current;if(!node)return;
    const px=node.clientWidth*x,py=node.clientHeight*y;
    const page=indexAt(node.scrollTop+py,previous.offsets);
    const pageLeft=(Math.max(previous.width,maxWidth*previous.scale+64)-viewSize(doc.pages[page])[0]*previous.scale)/2;
    zoomAnchor.current={page,localX:(node.scrollLeft+px-pageLeft)/previous.scale,localY:(node.scrollTop+py-previous.offsets[page])/previous.scale,x:px,y:py};
  }
  const go=(page:number,fraction=0)=>{if(!viewport.current)return;page=Math.max(0,Math.min(doc.pages.length-1,page));const top=Math.max(0,offsets[page]+fraction*(viewSize(doc.pages[page])[1]*scale+40)-24);ignoredTop.current=top;viewport.current.scrollTop=top;setScrollTop(viewport.current.scrollTop);};
  useImperativeHandle(ref,()=>({go,captureZoomAnchor}));
  useLayoutEffect(()=>{if(!viewport.current)return;const observer=new ResizeObserver(([entry])=>{setWidth(entry.contentRect.width);setHeight(entry.contentRect.height);});observer.observe(viewport.current);return()=>observer.disconnect();},[]);
  useEffect(()=>{if(restored.current!==doc.id){restored.current=doc.id;go(doc.currentPage);clearPdfCache();}},[doc.id,scale]);
  useLayoutEffect(()=>{
    const previous=layout.current,node=viewport.current;
    if(node&&previous.id===doc.id&&previous.scale!==scale){
      if(!zoomAnchor.current)captureZoomAnchor(.5,.5,previous);
      const anchor=zoomAnchor.current!;
      const pageLeft=(Math.max(width,maxWidth*scale+64)-viewSize(doc.pages[anchor.page])[0]*scale)/2;
      ignoredTop.current=null;
      node.scrollTop=offsets[anchor.page]+anchor.localY*scale-anchor.y;
      node.scrollLeft=pageLeft+anchor.localX*scale-anchor.x;
      setScrollTop(node.scrollTop);
    }
    zoomAnchor.current=null;layout.current={scale,width,offsets,id:doc.id};
  },[scale,width,doc.id]);
  // React's delegated wheel listener is passive in Chromium. A local non-passive
  // listener is required to prevent the browser from zooming the entire UI.
  const wheelCallback=useRef(props.onWheelZoom);wheelCallback.current=props.onWheelZoom;
  useEffect(()=>{
    const node=viewport.current;if(!node)return;
    const wheel=(event:WheelEvent)=>{
      if(!event.ctrlKey||event.deltaY===0)return;
      event.preventDefault();
      const rect=node.getBoundingClientRect();
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);
      const factor=Math.exp(-Math.max(-120,Math.min(120,delta))*.001);
      wheelCallback.current(factor,Math.max(0,Math.min(1,(event.clientX-rect.left)/node.clientWidth)),Math.max(0,Math.min(1,(event.clientY-rect.top)/node.clientHeight)));
    };
    node.addEventListener('wheel',wheel,{passive:false});
    return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const begin=Math.max(0,indexAt(scrollTop)-1),end=Math.min(doc.pages.length-1,indexAt(scrollTop+height)+1);
  return <div className="reader-scroll" ref={viewport} data-reader={side} onScroll={()=>{
    const top=viewport.current!.scrollTop;setScrollTop(top);
    if(ignoredTop.current!==null&&Math.abs(top-Math.min(ignoredTop.current,total-height))<2){ignoredTop.current=null;return;}
    ignoredTop.current=null;const page=indexAt(top+24),fraction=(top+24-offsets[page])/(viewSize(doc.pages[page])[1]*scale+40);onPosition(page,Math.max(0,fraction));
  }}><div className="page-stack" style={{height:total,minWidth:Math.max(width,maxWidth*scale+64)}}>
    {Array.from({length:end-begin+1},(_,i)=>i+begin).map(page=>{const info=doc.pages[page],translation=doc.translations[page],ready=side==='en'||translation?.status==='ready';const [w,h]=viewSize(info);return <div key={`${doc.id}-${page}`} className="page-position" style={{top:offsets[page],width:w*scale,height:h*scale,left:'50%',transform:'translateX(-50%)'}}>
      <div className="page-number">{page+1} <span>/ {doc.pages.length}</span></div>
      {ready?<PdfPage {...props} page={page} info={info} scale={scale} marks={props.marks.filter(m=>m.page===page)} matches={side==='en'?props.matches.filter(m=>m.page===page):[]}/>:<div className="translation-placeholder" style={{height:h*scale}}>
        <div className={`placeholder-icon ${translation?.status==='translating'?'active':''}`}>{translation?.status==='translating'?<LoaderCircle className="spin" size={25}/>:<Languages size={25}/>}</div>
        <h3>{translation?.status==='error'?'这一页暂未译好':translation?.status==='translating'?'正在生成中文页面':translation?.status==='queued'?'已加入翻译队列':'阅读到这里，再开始翻译'}</h3>
        <p>{translation?.status==='error'?translation.error:translation?.status==='translating'?translation.stage:'译文会保留原页码、图片与公式。'}</p>
        {translation?.status==='translating'?<><div className="progress-track"><i style={{width:`${Math.max(3,translation.progress)}%`}}/></div><small>{Math.round(translation.progress)}%</small></>:<button className="button secondary" onClick={()=>onTranslate(page)}>{translation?.status==='error'?<RotateCcw size={15}/>:<Languages size={15}/>} {translation?.status==='queued'?'优先翻译此页':translation?.status==='error'?'重试此页':'翻译此页及下一页'}</button>}
      </div>}
    </div>;})}
  </div></div>;
});
