import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export type MenuItem = { label:string; action?:()=>void; children?:MenuItem[]; disabled?:boolean; danger?:boolean; separator?:boolean };
export function ContextMenu({x,y,items,onClose}:{x:number;y:number;items:MenuItem[];onClose:()=>void}){
  const ref=useRef<HTMLDivElement>(null),[position,setPosition]=useState({left:x,top:y});
  const [trail,setTrail]=useState<{label:string;items:MenuItem[];index:number}[]>([]);
  const focusIndex=useRef(0);
  const visible=trail.at(-1)?.items||items;
  function back(){focusIndex.current=trail.at(-1)?.index||0;setTrail(value=>value.slice(0,-1));}
  function activate(item:MenuItem,index:number){
    if(item.children){focusIndex.current=1;setTrail(value=>[...value,{label:item.label,items:item.children!,index}]);}
    else{onClose();item.action?.();}
  }
  useLayoutEffect(()=>{
    const node=ref.current!;
    setPosition({left:Math.max(8,Math.min(x,innerWidth-node.offsetWidth-8)),top:Math.max(8,Math.min(y,innerHeight-node.offsetHeight-8))});
    node.scrollTop=0;
    node.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')[focusIndex.current]?.focus();
  },[x,y,visible]);
  useEffect(()=>{
    const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))onClose();};
    document.addEventListener('mousedown',close);window.addEventListener('resize',onClose);
    return()=>{document.removeEventListener('mousedown',close);window.removeEventListener('resize',onClose);};
  },[onClose]);
  return <div ref={ref} role="menu" aria-label={trail.at(-1)?.label||'快捷操作'} className="context-menu" style={position}
    onMouseDown={e=>e.preventDefault()} onContextMenu={e=>e.preventDefault()} onKeyDown={e=>{
      const buttons=[...ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(e.key==='Escape'||e.key==='ArrowLeft'){
        e.preventDefault();e.stopPropagation();if(trail.length)back();else if(e.key==='Escape')onClose();
      }else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){
        e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(index+(e.key==='ArrowDown'?1:buttons.length-1))%buttons.length;buttons[next]?.focus();
      }else if(e.key==='ArrowRight'&&document.activeElement?.getAttribute('aria-haspopup')==='menu'){
        e.preventDefault();(document.activeElement as HTMLButtonElement).click();
      }else if(e.key==='Tab'){onClose();}
    }}>
    {trail.length>0&&<button role="menuitem" className="menu-back" aria-label="返回上级菜单" title={trail.map(item=>item.label).join(' / ')} onClick={back}><ChevronLeft size={14}/><span>{trail.at(-1)!.label}</span></button>}
    {visible.map((item,i)=><button role="menuitem" key={i} disabled={item.disabled} title={item.label}
      aria-haspopup={item.children?'menu':undefined} aria-expanded={item.children?false:undefined}
      className={`${item.danger?'danger':''} ${item.separator?'menu-divider':''}`}
      onClick={()=>activate(item,i+(trail.length?1:0))}><span>{item.label}</span>{item.children&&<ChevronRight size={14}/>}</button>)}
  </div>;
}
