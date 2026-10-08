import { useEffect,useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { api,errorText,type Note } from './research-types';

function Attachment({src,noteId,alt}:{src:string;noteId:string;alt?:string}){
  const [url,setUrl]=useState('');
  useEffect(()=>{let alive=true;setUrl('');let relative=src;try{relative=decodeURIComponent(src);}catch{}if(!/^[a-z]+:|^\/\//i.test(relative))void api<string>('notesAsset',{id:noteId,relative}).then(url=>{if(alive)setUrl(url);}).catch(()=>{});return()=>{alive=false;};},[src,noteId]);
  return url?<img src={url} alt={alt||'笔记附件'}/>:<span className="missing-attachment">{alt||'附件'}（未加载）</span>;
}
export function MarkdownView({note,onOpen,onError}:{note:Note;onOpen?:(id:string)=>void;onError:(s:string)=>void}){
  const body=note.content.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n/,'').replace(/<!--\s*pdfsandwich:excerpt:[\w-]+\s*-->/g,'').replace(/^\^pdfsandwich-[\w-]+\s*$/gm,'').replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g,(_m,target)=>`![](<${target}>)`).replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_m,target,label)=>`[${label||target}](wiki:${encodeURIComponent(target)})`);
  async function link(href:string){try{if(href.startsWith('pdfsandwich://'))await api('researchLink',{link:href});else if(href.startsWith('wiki:')){const result=await api<Note|null>('notesWiki',{id:note.id,name:decodeURIComponent(href.slice(5))});if(result)onOpen?.(result.id);else onError('未找到对应笔记。');}else if(/^https?:/i.test(href))await api('researchExternal',{url:href});else if(/\.md(?:#|$)/i.test(href)){const result=await api<Note|null>('notesWiki',{id:note.id,name:decodeURIComponent(href).replace(/\.md(?=#|$)/,'')});if(result)onOpen?.(result.id);}}catch(error){onError(errorText(error));}}
  return <article className="markdown-body"><Markdown remarkPlugins={[remarkGfm,remarkMath]} rehypePlugins={[[rehypeKatex,{throwOnError:false,trust:false}]]} urlTransform={url=>/^(https?:|pdfsandwich:|wiki:)/i.test(url)||!/^\w+:/i.test(url)?url:''} components={{a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();void link(href||'');}}>{children}</a>,img:({src,alt})=><Attachment src={typeof src==='string'?src:''} alt={alt} noteId={note.id}/>}}>{body}</Markdown></article>;
}
