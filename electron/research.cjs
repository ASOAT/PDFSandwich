const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { NotesStore, sourceLink, decodeLink, within } = require('./notes.cjs');
const metadata = require('./metadata.cjs');

function createResearch({app, BrowserWindow, dialog, shell, clipboard, root, userDir, library, getDoc, getWindow, python, separatePython, openDocument, emit}) {
  const windows = new Set(), assets = new Map(), clips = new Map();
  const flushRequests=new Map();
  async function flushEditors(targets=[getWindow(),...windows]){
    const results=await Promise.all(targets.filter(window=>window&&!window.isDestroyed()).map(window=>new Promise(resolve=>{
      const id=crypto.randomUUID(),timer=setTimeout(()=>{flushRequests.delete(id);resolve(false);},15000);
      flushRequests.set(id,ok=>{clearTimeout(timer);flushRequests.delete(id);resolve(ok);});window.webContents.send('pdfsandwich:event',{type:'notes-request-flush',id});
    })));
    return results.every(Boolean);
  }
  const broadcast = event => { for (const window of [getWindow(),...windows]) if(window&&!window.isDestroyed())window.webContents.send('pdfsandwich:event',event); };
  const program = process.env.PDFSANDWICH_DATA_DIR ? userDir() : app.isPackaged ? path.dirname(app.getPath('exe')) : root;
  let notesError = '', notes;
  try { notes = new NotesStore(path.join(userDir(),'notes-settings.json'),path.join(program,'Notes'),broadcast); }
  catch(error) { notesError=error.message; }
  const store = () => { if(!notes)throw new Error(notesError || '笔记目录无法访问。');return notes; };
  function asset(file) { const id=crypto.createHash('sha256').update(file).digest('hex'); assets.set(id,file);return `pdfsandwich://asset/${id}`; }
  function currentDocument(id) {
    if(id)return library.get(id);
    const document=getDoc(); const item=library.data.documents.find(item=>item.path===document?.path);
    if(!item)throw new Error('请先从文献库打开 PDF。');return item;
  }
  async function navigate(link) {
    const target=decodeLink(link), item=library.get(target.documentId);
    if(target.page>=item.pages)throw new Error('链接页码超出文献范围。');
    if(getDoc()?.path!==item.path&&!await openDocument(item.path))return false;
    getWindow()?.show();getWindow()?.focus();
    const doc=getDoc();doc.currentPage=target.page;doc.currentFraction=target.rect?Math.max(0,(target.rect[1]-40)/doc.pages[target.page].height):0;
    emit();broadcast({type:'navigate',...target});return true;
  }
  function selectedFile(side,page) {
    const doc=getDoc();if(!doc||!Number.isInteger(page)||page<0||page>=doc.pages.length)throw new Error('请选择有效页面。');
    if(side==='zh'){const file=doc.translations[page]?.path;if(!file)throw new Error('这一页尚未完成翻译。');return {path:file,page:0};}
    return {path:doc.path,page};
  }
  async function excerptText(item) {
    const doc=getDoc();if(!doc)throw new Error('请先打开 PDF。');
    let en=item.en,zh=item.zh;
    if(!en||!zh) {
      try { const translated=doc.translations[item.page]?.path;const mapped=await python('map_annotation',{source_path:item.origin==='en'?doc.path:translated,target_path:item.origin==='en'?translated:doc.path,item});if(mapped?.geometry){if(item.origin==='en')zh=mapped.geometry;else en=mapped.geometry;} } catch {}
    }
    const source=en?.rects?.length?(await python('research_clip',{path:doc.path,page:item.page,rects:en.rects})).text:'';
    const translation=zh?.rects?.length&&doc.translations[item.page]?.path?(await python('research_clip',{path:doc.translations[item.page].path,page:0,rects:zh.rects})).text:'';
    return {source:source||(item.origin==='en'?item.selectedText||'':''),translation:translation||(item.origin==='zh'?item.selectedText||'':''),rects:en?.rects||[],page:item.page,annotationId:doc.annotations.some(mark=>mark.id===item.id)?item.id:undefined};
  }
  const actions = {
    researchSettings:()=>store().settings(),
    notesList:({query})=>store().list(query),
    notesGet:({id})=>store().get(id),
    notesCreate:({title,category,documentId})=>store().create({title,category,document:documentId?currentDocument(documentId):undefined}),
    notesForDocument:({documentId})=>store().create({document:currentDocument(documentId)}),
    notesSave:args=>store().save(args),
    notesRename:async args=>{const answer=await dialog.showMessageBox(getWindow(),{type:'question',buttons:['取消','重命名 / 移动'],defaultId:0,cancelId:0,message:'更新笔记文件位置？',detail:'正文与文献关联保持不变。其他笔记中手写的文件名链接可能需要更新。'});return answer.response===1?store().rename(args):null;},
    notesDelete:async({id})=>{
      const note=store().get(id);const result=await dialog.showMessageBox(getWindow(),{type:'warning',buttons:['取消','移到回收站'],defaultId:0,cancelId:0,message:`删除笔记“${note.title}”？`,detail:'PDF 和附件不会被删除。笔记可从系统回收站恢复。'});
      if(result.response!==1)return false;await shell.trashItem(store().resolve(note.relative));broadcast({type:'notes-changed'});return true;
    },
    notesReveal:({id})=>shell.showItemInFolder(store().resolve(store().get(id).relative)),
    notesFolder:()=>shell.openPath(store().root),
    notesConfigure:async({mode,notesFolder,migrate=false,choose=false})=>{
      if(!await flushEditors())throw new Error('请先保存或处理笔记编辑冲突，再切换笔记目录。');
      const config=notes?.settings()||{standaloneRoot:path.join(program,'Notes'),vault:'',notesFolder:'Papers'};
      const changes={mode,notesFolder:notesFolder??config.notesFolder};
      if(choose||mode==='obsidian'&&!config.vault) {
        const result=await dialog.showOpenDialog(getWindow(),{title:mode==='obsidian'?'选择 Obsidian Vault 根目录':'选择 Markdown 笔记文件夹',defaultPath:mode==='obsidian'?config.vault:config.standaloneRoot,properties:['openDirectory','createDirectory']});if(result.canceled)return null;
        const folder=result.filePaths[0], reserved=['resources','locales'].map(name=>path.join(program,name));
        if(reserved.some(root=>within(root,folder)))throw new Error('请选择程序资源目录以外的文件夹。');
        if(mode==='obsidian') {changes.vault=folder;const shared=path.join(folder,'.pdfsandwich','config.json');if(fs.existsSync(shared))changes.notesFolder=JSON.parse(fs.readFileSync(shared,'utf8')).notesFolder||'Papers';}
        else changes.standaloneRoot=folder;
      }
      if(!notes){const configFile=path.join(userDir(),'notes-settings.json');if(fs.existsSync(configFile))fs.copyFileSync(configFile,configFile+'.recovery');fs.writeFileSync(configFile,JSON.stringify({...config,...changes}));notes=new NotesStore(configFile,path.join(program,'Notes'),broadcast);notesError='';return notes.settings();}
      if(migrate){const answer=await dialog.showMessageBox(getWindow(),{type:'question',buttons:['取消','复制并切换'],defaultId:0,cancelId:0,message:'将当前笔记和附件复制到目标文件夹？',detail:'原目录完整保留；目标已有不同内容的同名文件时会停止。'});if(answer.response!==1)return null;}
      return store().configure(changes,migrate);
    },
    notesObsidian:async({id})=>{
      const note=store().get(id),cfg=store().settings();if(cfg.mode!=='obsidian')throw new Error('请先在设置中选择 Obsidian Vault。');
      const file=path.relative(cfg.vault,store().resolve(note.relative)).replace(/\\/g,'/');
      await shell.openExternal(`obsidian://open?vault=${encodeURIComponent(cfg.vault)}&file=${encodeURIComponent(file)}`);
    },
    notesAsset:({id,relative})=>{const storage=store(),note=storage.get(id),file=storage.attachmentPath(String(relative),note.relative);if(!['.png','.jpg','.jpeg','.gif','.webp'].includes(path.extname(file).toLowerCase()))throw new Error('不支持的附件格式。');return asset(file);},
    notesWiki:({name,id})=>{
      const storage=store(),target=String(name).split('#')[0].replace(/\.md$/i,''),cfg=storage.settings();
      const candidates=[path.resolve(storage.root,target+'.md')];
      if(id)candidates.push(path.resolve(path.dirname(storage.resolve(storage.get(id).relative)),target+'.md'));
      if(cfg.mode==='obsidian')candidates.push(path.resolve(cfg.vault,target+'.md'));
      return storage.list().find(n=>candidates.includes(storage.resolve(n.relative))||path.basename(n.relative,'.md')===target||n.title===target)||null;
    },
    notesPopout:async({id})=>{
      store().get(id);const existing=[...windows].find(w=>w.noteId===id);if(existing){existing.focus();return true;}
      const window=new BrowserWindow({width:700,height:820,minWidth:430,minHeight:400,title:'PDFSandwich · 笔记',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false}});
      window.noteId=id;windows.add(window);window.on('closed',()=>windows.delete(window));
      let canClose=false;window.on('close',event=>{if(canClose)return;event.preventDefault();void flushEditors([window]).then(ok=>{if(ok){canClose=true;window.close();}});});
      window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',e=>e.preventDefault());
      if(process.env.PDFSANDWICH_DEV_URL==='http://127.0.0.1:5173')await window.loadURL(`${process.env.PDFSANDWICH_DEV_URL}/?note=${encodeURIComponent(id)}`);
      else await window.loadFile(path.join(root,'dist','index.html'),{query:{note:id}});return true;
    },
    notesFlush:()=>true,
    notesFlushed:({token,ok})=>{flushRequests.get(token)?.(ok===true);return true;},
    researchLink:({link})=>navigate(link),
    researchCopy:({text})=>{clipboard.writeText(String(text).slice(0,1_000_000));return true;},
    researchExternal:({url})=>{const target=new URL(url);if(!['https:','http:'].includes(target.protocol))throw new Error('不支持此链接类型。');return shell.openExternal(target.href);},
    researchParagraphs:({page})=>{const doc=getDoc();selectedFile('en',page);return python('research_paragraphs',{path:doc.path,page,translated:doc.translations[page]?.path});},
    researchExcerpt:async({items})=>{if(!Array.isArray(items)||items.length>50)throw new Error('请每次摘录不超过 50 页。');const result=[];for(const item of items)result.push(await excerptText(item));return result;},
    notesExcerpt:async({excerpts,bilingual=true,thought='',noteId,clipId,latex})=>{
      const document=currentDocument();if(!Array.isArray(excerpts)||!excerpts.length||excerpts.length>50)throw new Error('无效摘录。');let result;noteId=noteId||store().create({document}).id;
      for(const excerpt of excerpts){let attachment; if(clipId){const clip=clips.get(clipId);if(!clip||clip.documentId!==document.id)throw new Error('截图已过期，请重新选择。');attachment=store().attachment(document.id,Buffer.from(clip.png,'base64'),noteId);}
        result=store().appendExcerpt({...excerpt,document,noteId,bilingual,thought,attachment,latex});noteId=result.note.id;
      }return result;
    },
    researchCapture:async({side,page,rect})=>{const file=selectedFile(side,page),document=currentDocument();const capture=await python('research_clip',{...file,rect,image:true});const id=crypto.randomUUID();clips.set(id,{...capture,documentId:document.id,page,side});if(clips.size>20)clips.delete(clips.keys().next().value);return {id,...capture,page,side};},
    formulaRecognize:async({clipId})=>{const clip=clips.get(clipId);if(!clip)throw new Error('截图已过期。');const target=path.join(userDir(),'formula-captures',`${clipId}.png`);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(clip.png,'base64'));return separatePython('formula_recognize',{image:target,directory:path.join(userDir(),'models','formula')});},
    libraryCover:async({id})=>{const item=library.get(id),stat=fs.statSync(item.path),target=path.join(userDir(),'covers',`${id}-${stat.mtimeMs}.png`);if(!fs.existsSync(target))await python('research_cover',{path:item.path,output:target});return asset(target);},
    metadataIdentify:({id})=>python('research_identifiers',{path:library.get(id).path}),
    metadataLookup:({query})=>metadata.lookup(query),
    metadataApply:({id,changes})=>{const fields=['title','authors','year','doi','abstract','journal','url','bibtex'];library.editDocument(id,Object.fromEntries(fields.filter(key=>typeof changes[key]==='string').map(key=>[key,changes[key]])));return library.snapshot();},
    metadataBibtex:({id})=>{const item=library.get(id);return item.bibtex||metadata.bibtex(item);},
    libraryMove:({ids,collectionId})=>{if(!Array.isArray(ids)||ids.length>10000)throw new Error('请选择文献。');for(const id of ids)library.editDocument(id,{collections:collectionId?[collectionId]:[]});return library.snapshot();},
    libraryOriginal:({id})=>{const item=library.get(id);shell.showItemInFolder(item.originalPath&&fs.existsSync(item.originalPath)?item.originalPath:item.path);},
    libraryLink:({id})=>sourceLink(library.get(id).id),
  };
  const trusted = event => [...windows].some(w=>!w.isDestroyed()&&event.sender===w.webContents&&event.senderFrame===w.webContents.mainFrame);
  return {actions,assets,navigate,trusted,broadcast,flush:flushEditors,dispose:()=>{notes?.dispose();for(const w of windows)w.destroy();}};
}
module.exports={createResearch};
