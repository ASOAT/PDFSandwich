import { useEffect,useRef,useState } from 'react';
import { FileText } from 'lucide-react';
import { api } from './research-types';
export function LibraryCover({id,title}:{id:string;title:string}){
  const ref=useRef<HTMLDivElement>(null),[url,setUrl]=useState('');
  useEffect(()=>{let alive=true,loaded=false;const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!loaded){loaded=true;void api<string>('libraryCover',{id}).then(value=>{if(alive)setUrl(value);}).catch(()=>{});observer.disconnect();}},{rootMargin:'200px'});if(ref.current)observer.observe(ref.current);return()=>{alive=false;observer.disconnect();};},[id]);
  return <div className="library-cover" ref={ref}>{url?<img src={url} alt={`${title} 封面`} loading="lazy"/>:<><FileText size={30}/><span>PDF</span></>}</div>;
}
