import { useEffect,useRef,useState } from 'react';
import { FilePlus2,Search,X,ExternalLink,FolderOpen,Trash2,NotebookPen,Settings2,PanelRightClose,Edit3,Eye,Save } from 'lucide-react';
import { LiveMarkdown } from './LiveMarkdown';
import { MarkdownView } from './MarkdownView';
import { registerNoteEditor } from './note-flush';
import { api,errorText,type Note,type NotesConfig } from './research-types';

export function NotesPanel({documentId,noteId,onClose,onSettings,popout=false,excerptId}:{documentId?:string;noteId?:string;onClose?:()=>void;onSettings?:()=>void;popout?:boolean;excerptId?:string}){
  const [list,setList]=useState<Note[]>([]),[query,setQuery]=useState(''),[category,setCategory]=useState(''),[note,setNote]=useState<Note|null>(null),[content,setContent]=useState(''),[preview,setPreview]=useState(false),[sourceMode,setSourceMode]=useState(false),[status,setStatus]=useState(''),[error,setError]=useState(''),[conflict,setConflict]=useState<{recovery:string;current:Note}|null>(null),[rename,setRename]=useState(false),[name,setName]=useState(''),[folder,setFolder]=useState('');
  const [cfg,setCfg]=useState<NotesConfig|null>(null),[showList,setShowList]=useState(!documentId&&!noteId);
  const configRef=useRef<NotesConfig|null>(null);
  const current=useRef<{note:Note|null;content:string}>({note:null,content:''}),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),saving=useRef<Promise<boolean>|null>(null),editor=useRef<HTMLTextAreaElement>(null),revision=useRef(0);
  const run=async<T,>(f:()=>Promise<T>)=>{try{setError('');return await f();}catch(e){setError(errorText(e));}};
  const refresh=()=>void api<Note[]>('notesList',{query}).then(setList).catch(e=>setError(errorText(e)));
  function install(value:Note){current.current={note:value,content:value.content};setNote(value);setContent(value.content);setConflict(null);setStatus('已保存');setName(value.relative.split(/[\\/]/).at(-1)!.replace(/\.md$/i,''));setFolder(value.category);}
  async function flush():Promise<boolean>{
    clearTimeout(timer.current);if(saving.current){if(!await saving.current)return false;return flush();}
    const snap=current.current;if(!snap.note||snap.content===snap.note.content)return true;
    setStatus('正在保存…');
    const task=(async()=>{try{
      const result=await api<{conflict:boolean;recovery:string;current:Note;note:Note}>('notesSave',{id:snap.note!.id,content:snap.content,base:snap.note!.content,version:snap.note!.version});
      if(result.conflict){setConflict(result);setStatus('存在编辑冲突');return false;}
      if(current.current.note?.id===snap.note!.id){
        let next=current.current.content;
        if(next===snap.content)next=result.note.content;
        else if(result.note.content!==snap.content){
          if(result.note.content.startsWith(snap.content))next+=result.note.content.slice(snap.content.length);
          else if(next.startsWith(snap.content))next=result.note.content+next.slice(snap.content.length);
          else{
            // Preserve both texts if external edits overlap typing that arrived during this save.
            const collision=await api<{recovery:string;current:Note}>('notesSave',{id:snap.note!.id,content:next,version:''});
            setConflict(collision);setStatus('存在编辑冲突');return false;
          }
        }
        current.current={note:result.note,content:next};setNote(result.note);setContent(next);if(next===result.note.content)localStorage.removeItem('note-draft:'+result.note.id);else localStorage.setItem('note-draft:'+result.note.id,JSON.stringify({base:result.note.content,version:result.note.version,content:next}));
      }
      setStatus('已保存');return true;
    }catch(e){setError(errorText(e));setStatus('未保存 · 本机草稿已保留');return false;}finally{saving.current=null;}})();saving.current=task;if(!await task)return false;return current.current.note&&current.current.content!==current.current.note.content?flush():true;
  }
  const flushRef=useRef(flush);flushRef.current=flush;
  useEffect(()=>registerNoteEditor(()=>flushRef.current()),[]);
  async function open(id:string){if(!await flush())return;const seq=++revision.current;const value=await run(()=>api<Note>('notesGet',{id}));if(!value||seq!==revision.current)return;install(value);setShowList(false);
    const draft=localStorage.getItem('note-draft:'+id);if(draft){try{const saved=JSON.parse(draft);if(saved.content!==value.content){current.current={note:{...value,content:saved.base,version:saved.version},content:saved.content};setContent(saved.content);setStatus('恢复上次未保存的草稿');await flush();}else localStorage.removeItem('note-draft:'+id);}catch(e){setError(errorText(e));}}
  }
  useEffect(()=>{refresh();void api<NotesConfig>('researchSettings').then(value=>{configRef.current=value;setCfg(value);}).catch(e=>setError(errorText(e)));},[query]);
  useEffect(()=>{let alive=true;void(async()=>{if(!await flushRef.current()||!alive)return;let id=noteId;if(documentId){const value=await run(()=>api<Note>('notesForDocument',{documentId}));id=value?.id;}if(id&&alive)await open(id);})();return()=>{alive=false;};},[documentId,noteId]);
  useEffect(()=>window.pdfsandwich.onEvent(event=>{if(event.type==='notes-changed'){refresh();const value=current.current;if(value.note&&!saving.current){if(value.content!==value.note.content){clearTimeout(timer.current);timer.current=setTimeout(()=>void flushRef.current(),200);}else void api<Note>('notesGet',{id:value.note.id}).then(next=>{if(current.current.note?.id===next.id&&current.current.content===current.current.note.content&&next.version!==current.current.note.version)install(next);}).catch(e=>setError(errorText(e)));}}if(event.type==='notes-settings'){const previous=configRef.current;configRef.current=event.settings||null;if(previous?.root!==event.settings?.root)void flushRef.current().then(ok=>{if(ok){current.current={note:null,content:''};setNote(null);setContent('');setShowList(true);refresh();}});setCfg(event.settings||null);}}),[query]);
  useEffect(()=>()=>{clearTimeout(timer.current);void flushRef.current();},[]);
  useEffect(()=>{if(!excerptId||!editor.current)return;const offset=content.indexOf(`<!-- pdfsandwich:excerpt:${excerptId}`);if(offset>=0){setPreview(false);editor.current.focus();editor.current.setSelectionRange(offset,offset);editor.current.scrollTop=content.slice(0,offset).split('\n').length*23;}},[excerptId,note?.id]);
  function edit(value:string){setContent(value);current.current={...current.current,content:value};if(current.current.note)localStorage.setItem('note-draft:'+current.current.note.id,JSON.stringify({base:current.current.note.content,version:current.current.note.version,content:value}));setStatus('未保存');clearTimeout(timer.current);timer.current=setTimeout(()=>void flushRef.current(),500);}
  async function create(){if(!await flush())return;const next=await run(()=>api<Note>('notesCreate',{title:'Untitled',category}));if(next){install(next);setShowList(false);setRename(true);refresh();}}
  return <section className={`notes-panel ${popout?'notes-popout':''}`} aria-label="Markdown 笔记">
    <header className="notes-heading"><button className="icon-button" title="笔记列表" onClick={()=>setShowList(!showList)}><NotebookPen size={18}/></button><strong>{showList?'Markdown 笔记':note?.title||'文献笔记'}</strong><button className="icon-button" title="新建笔记" onClick={()=>void create()}><FilePlus2 size={17}/></button>{onSettings&&<button className="icon-button" title="笔记设置" onClick={onSettings}><Settings2 size={17}/></button>}{onClose&&<button className="icon-button" title="收起笔记" onClick={()=>void flush().then(ok=>{if(ok)onClose();})}><PanelRightClose size={17}/></button>}</header>
    {showList?<div className="notes-browser"><label className="research-search"><Search size={16}/><input aria-label="搜索笔记" placeholder="搜索笔记内容…" value={query} onChange={e=>setQuery(e.target.value)}/></label><select aria-label="笔记分类" value={category} onChange={e=>setCategory(e.target.value)}><option value="">全部分类</option>{[...new Set(list.map(n=>n.category).filter(Boolean))].map(c=><option key={c}>{c}</option>)}</select><div className="note-list">{list.filter(n=>!category||n.category===category).map(n=><button key={n.id} className={n.id===note?.id?'active':''} onClick={()=>void open(n.id)}><strong>{n.title}</strong><small>{n.category||'根目录'} · {new Date(n.modified).toLocaleDateString()}</small><span>{n.tags.join(' · ')}</span></button>)}{!list.length&&<p className="empty-hint">暂无笔记</p>}</div></div>:note?<>
      <div className="notes-tools"><button className={!sourceMode&&!preview?'active':''} onClick={()=>{setSourceMode(false);setPreview(false);}}><Edit3 size={14}/>实时编辑</button><button className={sourceMode&&!preview?'active':''} onClick={()=>{setSourceMode(true);setPreview(false);}}>源码</button><button className={preview?'active':''} onClick={()=>setPreview(true)}><Eye size={14}/>只读</button><span/>{!popout&&<button title="在独立窗口打开" onClick={()=>void flush().then(ok=>ok&&run(()=>api('notesPopout',{id:note.id})))}><ExternalLink size={15}/></button>}<button title="重命名 / 分类" onClick={()=>setRename(true)}><Edit3 size={15}/></button><button title="笔记文件位置" onClick={()=>void run(()=>api('notesReveal',{id:note.id}))}><FolderOpen size={15}/></button><button title="删除笔记" onClick={()=>void flush().then(ok=>{if(ok)return run(async()=>{if(await api('notesDelete',{id:note.id})){localStorage.removeItem('note-draft:'+note.id);current.current={note:null,content:''};setNote(null);setShowList(true);refresh();}});})}><Trash2 size={15}/></button></div>
      {preview?<div className="notes-preview"><MarkdownView note={{...note,content}} onOpen={id=>void open(id)} onError={setError}/></div>:!sourceMode?<LiveMarkdown noteId={note.id} value={content} onChange={edit} onSave={()=>void flush()} onOpen={id=>void open(id)} onError={setError} focusText={excerptId?`<!-- pdfsandwich:excerpt:${excerptId}`:undefined}/>:<textarea ref={editor} className="markdown-editor" aria-label="Markdown 编辑器" value={content} spellCheck={false} onChange={e=>edit(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();void flush();}if(e.key==='Tab'){e.preventDefault();const target=e.currentTarget,a=target.selectionStart,b=target.selectionEnd;edit(content.slice(0,a)+'  '+content.slice(b));requestAnimationFrame(()=>target.setSelectionRange(a+2,a+2));}}}/>}
      <footer className="notes-status"><span>{status}</span><button title="立即保存" onClick={()=>void flush()}><Save size={14}/></button>{cfg?.mode==='obsidian'&&<button onClick={()=>void flush().then(ok=>ok&&run(()=>api('notesObsidian',{id:note.id})))}>在 Obsidian 打开</button>}</footer>
    </>:<div className="notes-empty"><NotebookPen size={32}/><p>选择或新建 Markdown 笔记</p><button className="button secondary" onClick={()=>void create()}>新建笔记</button></div>}
    {error&&<div className="research-error">{error}<button onClick={()=>setError('')}><X size={14}/></button></div>}
    {conflict&&<div className="notes-conflict"><strong>检测到另一处编辑</strong><p>你的内容已另存到：{conflict.recovery}</p><p>当前编辑框保留你的内容。可以复制需要的段落，再载入外部版本合并。</p><button className="button secondary" onClick={()=>{localStorage.removeItem('note-draft:'+conflict.current.id);install(conflict.current);}}>载入外部版本</button><button className="button secondary" onClick={()=>void api('researchCopy',{text:content})}>复制我的版本</button></div>}
    {rename&&note&&<div className="notes-rename"><h3>重命名 / 分类</h3><label>文件名<input aria-label="笔记文件名" value={name} onChange={e=>setName(e.target.value)}/></label><label>分类文件夹<input aria-label="笔记分类文件夹" value={folder} onChange={e=>setFolder(e.target.value)} placeholder="例如 Research/Planning"/></label><div className="modal-actions"><button className="button secondary" onClick={()=>setRename(false)}>取消</button><button className="button primary" onClick={()=>void flush().then(ok=>{if(ok)return run(async()=>{const value=await api<Note|null>('notesRename',{id:note.id,name,category:folder});if(value){install(value);setRename(false);refresh();}});})}>保存</button></div></div>}
  </section>;
}
