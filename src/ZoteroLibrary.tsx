import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { Collection } from './types';
import './library.css';

type Entry = { key:string; title:string; authors:string; year:string; filename:string; tags:string[]; collections:string[] };
type Snapshot = { library:string; serverId?:string; collections:Collection[]; documents:Entry[] };
type Libraries = { serverId?:string; libraries:{id:string;name:string}[] };

export function ZoteroLibrary({onOpen,onError}:{onOpen:(reference:{library:string;key:string;serverId?:string})=>Promise<void>;onError:(error:string)=>void}) {
  const [libraries,setLibraries]=useState<Libraries>({libraries:[]});
  const [library,setLibrary]=useState('users/0');
  const [data,setData]=useState<Snapshot|null>(null);
  const [collection,setCollection]=useState('');
  const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
  const [query,setQuery]=useState('');
  const [refresh,setRefresh]=useState(0);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [opening,setOpening]=useState('');

  useEffect(()=>{
    let alive=true;
    setLoading(true);setError('');setData(null);setCollection('');
    (async()=>{
      const result=await window.pdfsandwich.call<Libraries>('zoteroLibraries');
      if(!alive)return;
      setLibraries(result);
      const snapshot=await window.pdfsandwich.call<Snapshot>('zoteroSnapshot',{library,serverId:result.serverId});
      if(alive)setData(snapshot);
    })().catch(error=>{if(alive)setError(error.message.replace(/^Error invoking remote method '[^']+': Error: /,''));}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[library,refresh]);

  const rows=useMemo(()=>{
    if(!data)return [];
    const allowed=new Set([collection]);
    if(collection){
      for(let previous=-1;previous!==allowed.size;){previous=allowed.size;for(const c of data.collections)if(c.parentId&&allowed.has(c.parentId))allowed.add(c.id);}
    }
    const words=query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    return data.documents.filter(item=>(!collection||item.collections.some(id=>allowed.has(id)))&&words.every(word=>[item.title,item.authors,item.year,item.filename,...item.tags].join(' ').toLocaleLowerCase().includes(word)));
  },[data,collection,query]);

  function tree(parent:string|null=null,ancestors=new Set<string>()):React.ReactNode {
    return data?.collections.filter(c=>c.parentId===parent).map(c=>{
      if(ancestors.has(c.id))return null;
      const children=data.collections.some(child=>child.parentId===c.id);
      return <div key={c.id} style={{paddingLeft:parent?12:0}}>
        <div className={'collection-row '+(collection===c.id?'active':'')}>
          {children&&<button className="zotero-collapse" aria-label={(collapsed.has(c.id)?'展开 ':'折叠 ')+c.name} onClick={()=>setCollapsed(old=>{const value=new Set(old);value.has(c.id)?value.delete(c.id):value.add(c.id);return value;})}>{collapsed.has(c.id)?<ChevronRight size={13}/>:<ChevronDown size={13}/>}</button>}
          <button onClick={()=>setCollection(c.id)}><Folder size={14}/><span>{c.name}</span></button>
        </div>
        {children&&!collapsed.has(c.id)&&tree(c.id,new Set([...ancestors,c.id]))}
      </div>;
    });
  }
  async function open(entry:Entry){
    if(!data||opening)return;
    setOpening(entry.key);
    try{await onOpen({library:data.library,key:entry.key,serverId:data.serverId});}
    catch(error){onError((error as Error).message);}
    finally{setOpening('');}
  }
  return <div className="library-workspace zotero-library">
    <aside className="library-navigation">
      <div className="library-nav-title"><Folder size={18}/>Zotero</div>
      <label className="zotero-library-select">文库<select aria-label="Zotero 文库" value={library} disabled={loading} onChange={event=>setLibrary(event.target.value)}>{libraries.libraries.length?libraries.libraries.map(item=><option key={item.id} value={item.id}>{item.name}</option>):<option value="users/0">我的文库</option>}</select></label>
      <button className={'library-nav-row '+(!collection?'active':'')} onClick={()=>setCollection('')}><FileText size={15}/><span>全部 PDF</span><small>{data?.documents.length||0}</small></button>
      <div className="library-nav-heading">分类</div><div className="collection-list">{tree()}</div>
    </aside>
    <section className="zotero-content">
      <header className="library-heading"><h1>{data?.collections.find(c=>c.id===collection)?.name||'Zotero 文库'}<small>{rows.length} 份</small></h1><button className="button secondary" disabled={loading} onClick={()=>setRefresh(value=>value+1)}><RefreshCw size={15}/>刷新</button></header>
      <div className="library-search-row"><label className="library-search"><Search size={17}/><input aria-label="搜索 Zotero 文库" placeholder="搜索标题、作者、年份、标签…" value={query} onChange={event=>setQuery(event.target.value)}/></label></div>
      {loading?<div className="zotero-status" role="status"><LoaderCircle className="spin" size={22}/>正在读取 Zotero 文库…</div>:error?<div className="zotero-status" role="alert"><p>{error}</p><button className="button secondary" onClick={()=>setRefresh(value=>value+1)}>重新连接</button></div>:<div className="zotero-table-wrap"><table className="library-table zotero-table"><thead><tr><th>标题 / 附件</th><th>作者</th><th>年份</th><th/></tr></thead><tbody>{rows.map(entry=><tr key={entry.key} onDoubleClick={()=>void open(entry)}><td><strong>{entry.title}</strong><small>{entry.filename}</small>{entry.tags.length>0&&<span className="zotero-tags">{entry.tags.join(' · ')}</span>}</td><td>{entry.authors}</td><td>{entry.year}</td><td><button className="button secondary compact" disabled={!!opening} onClick={()=>void open(entry)}>{opening===entry.key?'正在打开…':'打开'}</button></td></tr>)}</tbody></table>{!rows.length&&<p className="zotero-status">{query||collection?'没有匹配的 PDF':'文库中暂无 PDF 附件'}</p>}</div>}
    </section>
  </div>;
}
