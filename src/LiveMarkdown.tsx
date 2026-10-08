import { useEffect,useRef } from 'react';
import { EditorState,StateField,type Range } from '@codemirror/state';
import { EditorView,Decoration,WidgetType,keymap,placeholder,type DecorationSet } from '@codemirror/view';
import { history,historyKeymap,defaultKeymap } from '@codemirror/commands';
import { markdown,markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree,syntaxHighlighting,defaultHighlightStyle } from '@codemirror/language';
import { GFM } from '@lezer/markdown';
import katex from 'katex';
import { api,errorText } from './research-types';

class PreviewWidget extends WidgetType {
  constructor(readonly kind:string,readonly value:string,readonly from:number,readonly noteId:string,readonly label=''){super();}
  eq(other:PreviewWidget){return this.kind===other.kind&&this.value===other.value&&this.from===other.from&&this.noteId===other.noteId;}
  toDOM(view:EditorView){
    const node=document.createElement(this.kind==='link'?'a':'span');node.className='live-'+this.kind;
    if(this.kind==='math'||this.kind==='math-block'){try{node.innerHTML=katex.renderToString(this.value,{displayMode:this.kind==='math-block',throwOnError:false,trust:false});}catch{node.textContent=this.value;}}
    else if(this.kind==='image'){
      const img=document.createElement('img');img.alt=this.label||'笔记附件';node.append(img);
      let relative=this.value;try{relative=decodeURIComponent(relative);}catch{}
      if(!/^\w+:|^\/\//.test(relative))void api<string>('notesAsset',{id:this.noteId,relative}).then(url=>img.src=url).catch(()=>{img.alt='附件未找到';});
    }else if(this.kind==='table'){
      const table=document.createElement('table'),rows=this.value.trim().split('\n').map(row=>row.replace(/^\s*\||\|\s*$/g,'').split('|').map(cell=>cell.trim()));
      rows.forEach((row,index)=>{if(index===1)return;const tr=document.createElement('tr');for(const cell of row){const td=document.createElement(index===0?'th':'td');td.textContent=cell;tr.append(td);}table.append(tr);});node.append(table);
    }else if(this.kind==='metadata'){node.textContent='文献属性 · YAML';}
    else if(this.kind==='link'){node.textContent=this.label||this.value;(node as HTMLAnchorElement).href='#';node.title='Ctrl + 点击打开；点击编辑链接';}
    else node.textContent=this.value;
    node.addEventListener('mousedown',event=>{
      event.preventDefault();
      if(this.kind==='link'&&((event as MouseEvent).ctrlKey||(event as MouseEvent).metaKey)){
        const value=this.value;
        if(value.startsWith('pdfsandwich://'))void api('researchLink',{link:value}).catch(error=>node.dispatchEvent(new CustomEvent('note-error',{detail:errorText(error),bubbles:true})));
        else if(/^https?:/.test(value))void api('researchExternal',{url:value}).catch(error=>node.dispatchEvent(new CustomEvent('note-error',{detail:errorText(error),bubbles:true})));
        else node.dispatchEvent(new CustomEvent('note-link',{detail:value,bubbles:true}));
      }else{view.dispatch({selection:{anchor:Math.min(this.from+1,view.state.doc.length)},scrollIntoView:true});view.focus();}
    });
    node.addEventListener('click',e=>e.preventDefault());return node;
  }
  ignoreEvent(){return true;}
}

function liveDecorations(noteId:string){
  return StateField.define<DecorationSet>({
    create:state=>build(state),update:(value,tr)=>tr.docChanged||tr.selection?build(tr.state):value,
    provide:field=>EditorView.decorations.from(field),
  });
  function build(state:EditorState){
    const ranges:Range<Decoration>[]=[],text=state.doc.toString(),selection=state.selection.main;
    const activeFrom=state.doc.lineAt(selection.from).from,activeTo=state.doc.lineAt(selection.to).to;
    const active=(from:number,to:number)=>from<=activeTo&&to>=activeFrom;
    const replaced:[number,number][]=[];
    const overlaps=(a:number,b:number)=>replaced.some(([c,d])=>a<d&&b>c);
    function widget(from:number,to:number,kind:string,value:string,label='',block=false){if(active(from,to)||overlaps(from,to))return;ranges.push(Decoration.replace({widget:new PreviewWidget(kind,value,from,noteId,label),block}).range(from,to));replaced.push([from,to]);}
    const fm=/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);
    if(fm)widget(0,fm[0].length-1,'metadata','', '',true);
    // Fenced code remains literal. Formula decorations never alter the source.
    const codeRanges:[number,number][]=[];
    syntaxTree(state).iterate({enter:node=>{if(['FencedCode','InlineCode','CodeBlock'].includes(node.name))codeRanges.push([node.from,node.to]);}});
    const codeAt=(from:number,to:number)=>codeRanges.some(([a,b])=>from<b&&to>a);
    syntaxTree(state).iterate({enter:node=>{if(node.name==='Table')widget(node.from,node.to,'table',text.slice(node.from,node.to),'',true);}});
    for(const match of text.matchAll(/^\$\$\s*\n([\s\S]*?)\n\$\$\s*$/gm))if(!codeAt(match.index!,match.index!+match[0].length))widget(match.index!,match.index!+match[0].length,'math-block',match[1],'',true);
    for(const match of text.matchAll(/(?<![\\$])\$([^$\n]+)\$(?!\$)/g))if(!codeAt(match.index!,match.index!+match[0].length))widget(match.index!,match.index!+match[0].length,'math',match[1]);
    for(const match of text.matchAll(/!\[([^\]]*)\]\((?:<([^>]+)>|([^\s)]+))\)/g))if(!codeAt(match.index!,match.index!+match[0].length))widget(match.index!,match.index!+match[0].length,'image',match[2]||match[3],match[1]);
    for(const match of text.matchAll(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g))if(!codeAt(match.index!,match.index!+match[0].length))widget(match.index!,match.index!+match[0].length,'image',match[1],match[2]||'');
    for(const match of text.matchAll(/(?<!!)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g))if(!codeAt(match.index!,match.index!+match[0].length))widget(match.index!,match.index!+match[0].length,'link','wiki:'+match[1],match[2]||match[1]);
    for(const match of text.matchAll(/<!--\s*pdfsandwich:excerpt:[\w-]+\s*-->|^\^pdfsandwich-[\w-]+\s*$/gm))if(!active(match.index!,match.index!+match[0].length)&&!codeAt(match.index!,match.index!+match[0].length))ranges.push(Decoration.replace({}).range(match.index!,match.index!+match[0].length));
    const lineClasses=new Map<number,string[]>();
    function lineClass(from:number,to:number,name:string){for(let line=state.doc.lineAt(from);line.from<=to;){const existing=lineClasses.get(line.from)||[];if(!existing.includes(name))existing.push(name);lineClasses.set(line.from,existing);if(line.number>=state.doc.lines)break;line=state.doc.line(line.number+1);}}
    syntaxTree(state).iterate({enter:node=>{
      const {name,from,to}=node;if(overlaps(from,to)&&replaced.some(([a,b])=>from>=a&&to<=b))return false;
      if(/^ATXHeading\d$/.test(name))lineClass(from,to,'live-heading live-h'+name.slice(-1));
      if(name==='Blockquote')lineClass(from,to,'live-quote');
      if(name==='FencedCode')lineClass(from,to,'live-code-line');
      if(name==='ListItem')lineClass(from,to,'live-list-item');
      if(['StrongEmphasis','Emphasis','Strikethrough','InlineCode'].includes(name))ranges.push(Decoration.mark({class:{StrongEmphasis:'live-strong',Emphasis:'live-em',Strikethrough:'live-strike',InlineCode:'live-code'}[name]}).range(from,to));
      if(['HeaderMark','HeadingMark','EmphasisMark','StrikethroughMark','QuoteMark','CodeMark'].includes(name)&&!active(from,to)&&!codeAt(from,to)&&!overlaps(from,to))ranges.push(Decoration.replace({}).range(from,to));
      if(name==='Link'&&!active(from,to)&&!overlaps(from,to)){const value=text.slice(from,to),match=/^\[([^\]]+)\]\((.+)\)$/.exec(value);if(match)widget(from,to,'link',match[2].replace(/^<(.+)>$/,'$1'),match[1]);}
    }});
    for(const [from,classes] of lineClasses)if(!overlaps(from,from+1))ranges.push(Decoration.line({class:classes.join(' ')}).range(from));
    return Decoration.set(ranges,true);
  }
}

export function LiveMarkdown({value,noteId,onChange,onSave,onOpen,onError,focusText}:{value:string;noteId:string;onChange:(s:string)=>void;onSave:()=>void;onOpen:(id:string)=>void;onError:(s:string)=>void;focusText?:string}){
  const host=useRef<HTMLDivElement>(null),view=useRef<EditorView|null>(null),callbacks=useRef({onChange,onSave,onOpen,onError});callbacks.current={onChange,onSave,onOpen,onError};
  const external=useRef(false);
  useEffect(()=>{
    const frontmatter=/^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(value);
    const editor=new EditorView({parent:host.current!,state:EditorState.create({doc:value,selection:{anchor:frontmatter?.[0].length||0},extensions:[
      markdown({extensions:[GFM]}),history(),keymap.of([{key:'Mod-s',run:()=>{callbacks.current.onSave();return true;}},...markdownKeymap,...historyKeymap,...defaultKeymap]),syntaxHighlighting(defaultHighlightStyle),EditorView.lineWrapping,placeholder('写下你的笔记…'),liveDecorations(noteId),
      EditorView.contentAttributes.of({'aria-label':'实时 Markdown 编辑器',spellcheck:'false'}),
      EditorView.updateListener.of(update=>{if(update.docChanged&&!external.current)callbacks.current.onChange(update.state.doc.toString());}),
      EditorView.domEventHandlers({keydown:event=>{if((event.ctrlKey||event.metaKey)&&['s','z','y','f'].includes(event.key.toLowerCase()))event.stopPropagation();return false;}}),
    ]})});view.current=editor;
    const link=async(event:Event)=>{const name=(event as CustomEvent<string>).detail.replace(/^wiki:/,'');try{const note=await api<{id:string}|null>('notesWiki',{name,id:noteId});if(note)callbacks.current.onOpen(note.id);else callbacks.current.onError('未找到对应笔记。');}catch(e){callbacks.current.onError(errorText(e));}};
    const error=(event:Event)=>callbacks.current.onError((event as CustomEvent<string>).detail);
    host.current!.addEventListener('note-error',error);host.current!.addEventListener('note-link',link);
    return()=>{host.current?.removeEventListener('note-error',error);host.current?.removeEventListener('note-link',link);view.current=null;editor.destroy();};
  },[noteId]);
  useEffect(()=>{const editor=view.current;if(!editor)return;const old=editor.state.doc.toString();if(old===value)return;let from=0;while(from<old.length&&from<value.length&&old[from]===value[from])from++;let endOld=old.length,endNew=value.length;while(endOld>from&&endNew>from&&old[endOld-1]===value[endNew-1]){endOld--;endNew--;}external.current=true;editor.dispatch({changes:{from,to:endOld,insert:value.slice(from,endNew)}});external.current=false;},[value]);
  useEffect(()=>{if(!focusText||!view.current)return;const editor=view.current,index=editor.state.doc.toString().indexOf(focusText);if(index>=0)editor.dispatch({selection:{anchor:index},scrollIntoView:true});},[focusText,noteId]);
  return <div className="live-markdown" ref={host}/>;
}
