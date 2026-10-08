const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const YAML = require('yaml');
const {NoteIndex}=require('./note-index.cjs');
const {templateContent}=require('./note-template.cjs');

const hash = text => createHash('sha256').update(text).digest('hex');
const slug = name => String(name || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 110) || 'Untitled';
const within = (root, file) => { const relative = path.relative(root, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
function atomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, content, { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function parse(content) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match) return { meta: {}, body: content };
  try { return { meta: YAML.parse(match[1], { maxAliasCount: 50 }) || {}, body: content.slice(match[0].length) }; }
  catch { return { meta: {}, body: content }; }
}
function mapImages(content, transform) {
  const literal=[...content.matchAll(/^```[^\n]*\n[\s\S]*?^```\s*$|^~~~[^\n]*\n[\s\S]*?^~~~\s*$|`+[^`\n]+`+/gm)].map(m=>[m.index,m.index+m[0].length]);
  return content.replace(/!\[([^\]\n]*)\]\((?:<([^>\n]+)>|([^\s)]+))\)|!\[\[([^\]\n]+)\]\]/g,(match,alt,angle,plain,wiki,offset)=>{
    if(literal.some(([a,b])=>offset>=a&&offset<b))return match;
    let name=angle||plain||wiki.split('|')[0];if(/^[a-z][a-z0-9+.-]*:/i.test(name))return match;
    try{name=decodeURIComponent(name);}catch{}
    const target=transform(name);return target?`![${alt||''}](<${target}>)`:match;
  });
}
function rebaseLinks(content, oldDirectory, newDirectory) {
  const relative=value=>{
    if(/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value))return value;
    const parts=value.split('#');let decoded=parts[0];try{decoded=decodeURIComponent(decoded);}catch{}const file=path.resolve(oldDirectory,decoded);
    return path.relative(newDirectory,file).replace(/\\/g,'/')+(parts.length>1?'#'+parts.slice(1).join('#'):'');
  };
  return content.replace(/(!?\[[^\]\n]*\])\((?:<([^>\n]+)>|([^\s)]+))\)/g,(match,label,a,b)=>{const value=a||b,target=relative(value);return target===value?match:`${label}(<${target}>)`;});
}
function sourceLink(documentId, page = 0, annotationId, rect) {
  const url = new URL(`pdfsandwich://document/${encodeURIComponent(documentId)}`);
  url.searchParams.set('page', String(page + 1));
  if (annotationId) url.searchParams.set('annotation', annotationId);
  if (rect) url.searchParams.set('rect', rect.join(','));
  return url.toString();
}
function decodeLink(link) {
  const url = new URL(link);
  if (url.protocol !== 'pdfsandwich:' || url.hostname !== 'document' || !/^\/[\w-]+$/.test(url.pathname)) throw new Error('无法识别的文献链接。');
  const page = Number(url.searchParams.get('page') || 1) - 1;
  if (!Number.isSafeInteger(page) || page < 0) throw new Error('无效页码。');
  const rect = url.searchParams.get('rect')?.split(',').map(Number);
  if (rect && (rect.length !== 4 || rect.some(v => !Number.isFinite(v) || v < 0) || rect[2] <= rect[0] || rect[3] <= rect[1])) throw new Error('无效位置。');
  return { documentId: url.pathname.slice(1), page, annotationId: url.searchParams.get('annotation'), rect };
}
// Merge a local edit with an external append (the common excerpt workflow).
// Ambiguous overlapping edits are preserved as a separate recovery file instead.
function mergeAppend(base, local, remote) {
  if (local === base) return remote;
  if (remote === base || local === remote) return local;
  if (remote.startsWith(base)) return local + remote.slice(base.length);
  if (local.startsWith(base)) return remote + local.slice(base.length);
  return null;
}

class NotesStore {
  constructor(configFile, defaultRoot, onChange = () => {}) {
    this.configFile = configFile; this.defaultRoot = path.resolve(defaultRoot); this.onChange = onChange;
    this.config = { mode: 'standalone', standaloneRoot: this.defaultRoot, vault: '', notesFolder: 'Papers', templateFile: '' };
    if (fs.existsSync(configFile)) Object.assign(this.config, JSON.parse(fs.readFileSync(configFile, 'utf8')));
    this.watchers = []; this.timer = null; this.index = new Map(); this.connect();
  }
  settings() { return { ...this.config, root: this.root, attachmentDirectory:this.attachmentDirectory() }; }
  attachmentDirectory(noteRelative='', config=this.config, notesRoot=this.root) {
    if(config.mode!=='obsidian')return path.join(notesRoot,'assets');
    const vault=path.resolve(config.vault), file=path.join(vault,'.obsidian','app.json');
    const value=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')).attachmentFolderPath:'';
    const folder=typeof value==='string'?value.replace(/\\/g,'/'):'';
    const current=path.dirname(path.join(notesRoot,noteRelative||'Untitled.md'));
    const target=folder==='.'?current:folder.startsWith('./')?path.resolve(current,folder.slice(2)):folder==='/'?vault:path.resolve(vault,folder);
    if(!within(vault,target)||path.relative(vault,target).split(path.sep).some(p=>p.startsWith('.')))throw new Error('Obsidian 附件目录必须位于 Vault 的普通文件夹内。');
    this.noSymlinks(vault,target);return target;
  }
  attachmentPath(relative,noteRelative='') {
    const base=this.config.mode==='obsidian'?path.resolve(this.config.vault):this.root;
    if(typeof relative!=='string'||path.isAbsolute(relative)||/^[a-z][a-z0-9+.-]*:/i.test(relative))throw new Error('无效的附件路径。');
    const allowed=file=>within(base,file)&&!path.relative(base,file).split(path.sep).some(p=>p.startsWith('.'));
    const candidates=[path.resolve(path.dirname(path.join(this.root,noteRelative||'Untitled.md')),relative),path.resolve(base,relative)];
    let file=candidates.find(p=>allowed(p)&&fs.existsSync(p)&&fs.statSync(p).isFile());
    if(!file&&this.config.mode==='obsidian'&&!/[\\/]/.test(relative)){
      const matches=this.walk(base,true).filter(p=>path.basename(p).toLowerCase()===relative.toLowerCase());
      if(matches.length===1)file=path.join(base,matches[0]);
    }
    if(!file||!allowed(file))throw new Error('附件不存在，或超出所选笔记目录。');
    this.noSymlinks(base,file);return file;
  }
  connect() {
    this.dispose();
    if (this.config.mode === 'obsidian') {
      if (!this.config.vault || !fs.existsSync(this.config.vault)) throw new Error('Obsidian Vault 不存在，请重新选择。');
      const shared = path.join(this.config.vault, '.pdfsandwich', 'config.json');
      if (fs.existsSync(shared)) {
        const value = JSON.parse(fs.readFileSync(shared, 'utf8'));
        if (typeof value.notesFolder === 'string') this.config.notesFolder = value.notesFolder;
        this.config.templateFile = typeof value.templateFile === 'string' ? value.templateFile : '';
      }
      this.root = this.safeFolder(this.config.vault, this.config.notesFolder);
    } else this.root = path.resolve(this.config.standaloneRoot || this.defaultRoot);
    fs.mkdirSync(this.root, { recursive: true });
    this.associations=new NoteIndex(this.config.mode==='obsidian'?this.config.vault:this.root);
    this.index=new Map();this.scan();
    const changed = () => { clearTimeout(this.timer); this.timer = setTimeout(() => { try { this.scan(); this.onChange({ type: 'notes-changed' }); } catch (error) { this.onChange({ type: 'notes-error', error: error.message }); } }, 180); };
    this.watchers.push(fs.watch(this.root, { recursive: true }, changed));
    if (this.config.mode === 'obsidian') {
      const sharedDir = path.join(this.config.vault, '.pdfsandwich'); fs.mkdirSync(sharedDir, { recursive: true });
      this.watchers.push(fs.watch(sharedDir, (_event, filename) => {
        if (String(filename) !== 'config.json') return;
        clearTimeout(this.configTimer); this.configTimer = setTimeout(() => {
          try {
            const shared = JSON.parse(fs.readFileSync(path.join(sharedDir, 'config.json'), 'utf8'));
            if (shared.notesFolder !== this.config.notesFolder || (shared.templateFile||'') !== this.config.templateFile) {
              this.safeFolder(this.config.vault, shared.notesFolder); this.config.notesFolder = shared.notesFolder;this.config.templateFile=shared.templateFile||'';
              atomic(this.configFile, JSON.stringify(this.config, null, 2)); this.connect(); this.onChange({ type: 'notes-settings', settings: this.settings() });
            }
          } catch (error) { this.onChange({ type: 'notes-error', error: error.message }); }
        }, 250);
      }));
    }
  }
  dispose() { clearTimeout(this.timer); clearTimeout(this.configTimer); for (const watcher of this.watchers || []) watcher.close(); this.watchers = []; }
  safeFolder(root, relative) {
    if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(p => p === '..' || p.startsWith('.'))) throw new Error('请使用 Vault 内的普通子文件夹。');
    const folder = path.resolve(root, relative); if (!within(path.resolve(root), folder)) throw new Error('文件夹不能超出 Vault。');
    this.noSymlinks(path.resolve(root), folder); return folder;
  }
  noSymlinks(root, file) {
    let current = file;
    while (within(root, current)) {
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('笔记目录内不支持符号链接或联接点。');
      if (current === root) break; current = path.dirname(current);
    }
  }
  resolve(relative, allowParents = false) {
    if (typeof relative !== 'string' || path.isAbsolute(relative)) throw new Error('无效的笔记路径。');
    const file = path.resolve(this.root, relative);
    if (!within(this.root, file) || relative.split(/[\\/]/).some(p => p.startsWith('.') && !(allowParents && ['.','..'].includes(p)))) throw new Error('笔记路径超出所选目录。');
    this.noSymlinks(this.root, file); return file;
  }
  configure(changes, migrate = false) {
    const previous = { ...this.config }, oldRoot = this.root;
    const next = { ...this.config, ...changes };
    const migrationNotes=migrate?this.list():[];
    if (!['standalone', 'obsidian'].includes(next.mode)) throw new Error('未知笔记模式。');
    if (next.mode === 'obsidian' && !fs.existsSync(next.vault)) throw new Error('请选择已存在的 Vault。');
    const nextRoot = next.mode === 'obsidian' ? this.safeFolder(next.vault, next.notesFolder) : path.resolve(next.standaloneRoot);
    if (migrate && nextRoot !== oldRoot) {
      if (within(oldRoot, nextRoot) || within(nextRoot, oldRoot)) throw new Error('迁移目录不能相互包含。');
      const files = this.walk(oldRoot, true), plans=new Map(files.map(relative=>[path.join(nextRoot,relative),{source:path.join(oldRoot,relative)}]));
      for(const relative of files.filter(p=>p.toLowerCase().endsWith('.md'))){
        const file=path.join(oldRoot,relative),text=fs.readFileSync(file,'utf8');
        const transformed=mapImages(text,name=>{
          const source=this.attachmentPath(name,relative);
          if(!['.png','.jpg','.jpeg','.gif','.webp'].includes(path.extname(source).toLowerCase()))return null;
          const directory=this.attachmentDirectory(relative,next,nextRoot);
          const destination=path.join(directory,`pdfsandwich-${hash(fs.readFileSync(source)).slice(0,24)}${path.extname(source)}`);
          plans.set(destination,{source});
          return path.relative(path.dirname(path.join(nextRoot,relative)),destination).replace(/\\/g,'/');
        });
        if(transformed!==text)plans.set(path.join(nextRoot,relative),{source:file,content:Buffer.from(transformed)});
      }
      const allowedRoot=next.mode==='obsidian'?path.resolve(next.vault):nextRoot;
      for(const [target,entry] of plans){
        if(!within(allowedRoot,target))throw new Error('迁移附件超出目标目录。');this.noSymlinks(allowedRoot,target);
        if(fs.existsSync(target)&&hash(fs.readFileSync(target))!==hash(entry.content||fs.readFileSync(entry.source)))throw new Error(`目标已有不同内容的文件：${path.relative(allowedRoot,target)}。请使用空文件夹迁移。`);
      }
      for(const [target,entry] of plans){
        fs.mkdirSync(path.dirname(target),{recursive:true});
        if(!fs.existsSync(target)){if(entry.content)fs.writeFileSync(target,entry.content,{flag:'wx'});else fs.copyFileSync(entry.source,target,fs.constants.COPYFILE_EXCL);}
      }
    }
    try {
      fs.mkdirSync(nextRoot, { recursive: true });
      if (next.mode === 'obsidian') {
        const shared=path.join(next.vault,'.pdfsandwich','config.json');
        const latest=fs.existsSync(shared)?JSON.parse(fs.readFileSync(shared,'utf8')):{};
        const value={...latest,version:1,notesFolder:next.notesFolder};
        if(Object.hasOwn(changes,'templateFile'))value.templateFile=changes.templateFile;
        atomic(shared,JSON.stringify(value,null,2));
      }
      if(migrate&&nextRoot!==oldRoot){const index=new NoteIndex(next.mode==='obsidian'?next.vault:nextRoot);for(const note of migrationNotes)index.register(path.join(nextRoot,note.relative),note.id,note.documentId);}
      this.config = next; this.connect(); atomic(this.configFile, JSON.stringify(this.config, null, 2));
    } catch (error) { this.config = previous; this.connect(); throw error; }
    this.onChange({ type: 'notes-settings', settings: this.settings() }); return this.settings();
  }
  walk(root = this.root, assets = false) {
    const files = []; const visit = (dir, depth) => {
      if (depth > 30 || files.length > 20000) throw new Error('笔记目录过大，请选择更具体的子文件夹。');
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(file, depth + 1);
        else if (entry.isFile() && (assets || entry.name.toLowerCase().endsWith('.md'))) files.push(path.relative(root, file));
      }
    }; if (fs.existsSync(root)) visit(root, 0); return files;
  }
  scan() {
    const result = new Map();this.associations.reload();
    const cachedByPath=new Map([...this.index.values()].map(note=>[note.relative,note]));
    for (const relative of this.walk()) {
      const file = this.resolve(relative), stat = fs.statSync(file); if (stat.size > 5 * 1024 * 1024) continue;
      const cached=cachedByPath.get(relative);
      if(cached&&cached.modified===stat.mtimeMs&&cached.bytes===stat.size){result.set(cached.id,cached);continue;}
      const content = fs.readFileSync(file, 'utf8'), { meta, body } = parse(content);
      const {id,documentId}=this.associations.identify(file,stat,content,meta);
      if (result.has(id)) continue;
      result.set(id, { id, relative, title: String(meta.title || /^#\s+(.+)$/m.exec(body)?.[1] || path.basename(file, '.md')), documentId: String(documentId), category: path.dirname(relative) === '.' ? '' : path.dirname(relative), tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [], modified: stat.mtimeMs, bytes:stat.size, content, version: hash(content) });
    }
    this.associations.flush();this.index = result;
  }
  list(query = '') { this.scan(); const q = String(query).toLowerCase(); return [...this.index.values()].filter(n => !q || (n.title + '\n' + n.content).toLowerCase().includes(q)).sort((a,b) => b.modified - a.modified).map(({ content, ...n }) => n); }
  get(id) {
    this.index.delete(id);this.scan();let note=this.index.get(id);if(!note)throw new Error('笔记已移动或删除，请刷新列表。');
    // Import legacy IDs into the sidecar before removing just these two properties.
    const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(note.content);
    if(match){const yaml=YAML.parseDocument(match[1]);if(!yaml.errors.length&&(yaml.has('pdfsandwich_note_id')||yaml.has('pdfsandwich_document_id'))){
      let header=match[1];const fields=yaml.contents.items.filter(pair=>['pdfsandwich_note_id','pdfsandwich_document_id'].includes(pair.key?.value));
      for(const pair of fields.sort((a,b)=>b.key.range[0]-a.key.range[0])){const start=header.lastIndexOf('\n',pair.key.range[0]-1)+1,end=pair.value?.range?.[2]??header.indexOf('\n',pair.key.range[0])+1;header=header.slice(0,start)+header.slice(end>start?end:header.length);}
      const body=note.content.slice(match[0].length),content=yaml.contents.items.length>fields.length?'---\n'+header.trimEnd()+'\n---\n'+body:body;
      atomic(path.join(this.root,'.pdfsandwich','history',slug(id),`${Date.now()}-legacy-properties.md`),note.content);
      atomic(this.resolve(note.relative),content);this.index.delete(id);this.scan();note=this.index.get(id);
    }}return {...note};
  }
  create({ title = 'Untitled', category = '', document } = {}) {
    this.scan();
    if (document) { const existing = [...this.index.values()].find(n => n.documentId === document.id); if (existing) return this.get(existing.id); }
    const id=randomUUID(),noteTitle=document?.title||title;
    const content=templateContent(this.config,{...document,title:noteTitle},(root,relative)=>this.safeFolder(root,relative));
    const base=this.resolve(path.join(category,slug(noteTitle)));
    let file=base+'.md';if(fs.existsSync(file))file=base+' - '+id.slice(0,8)+'.md';
    fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,{flag:'wx'});
    this.associations.register(file,id,document?.id||'');
    this.onChange({ type: 'notes-changed', id }); return this.get(id);
  }
  save({ id, content, version, base }) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 5 * 1024 * 1024) throw new Error('笔记内容超过 5 MB。');
    const note = this.get(id);
    if (note.version !== version) {
      const merged = typeof base === 'string' && hash(base) === version ? mergeAppend(base, content, note.content) : null;
      if (merged === null) {
        const recovery = path.join(this.root, '.pdfsandwich', 'conflicts', `${slug(id)}-${Date.now()}-${randomUUID().slice(0,8)}.md`);
        atomic(recovery, content); return { conflict: true, recovery, current: note };
      }
      content = merged;
    }
    if (note.content !== content) {
      const backups = path.join(this.root, '.pdfsandwich', 'history', slug(id));
      atomic(path.join(backups, `${Date.now()}-${note.version.slice(0,12)}.md`), note.content);
      const old = fs.readdirSync(backups).sort().slice(0, -20); for (const filename of old) fs.unlinkSync(path.join(backups, filename));
      atomic(this.resolve(note.relative), content);
    }
    this.onChange({ type: 'notes-changed', id }); return { conflict: false, note: this.get(id) };
  }
  rename({ id, name, category = '' }) {
    const note = this.get(id), destination = this.resolve(path.join(category, slug(name) + '.md'));
    const source = this.resolve(note.relative);
    if (destination !== source && fs.existsSync(destination)) throw new Error('已有同名笔记。');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    // The rename is explicit; change its title while retaining all other YAML and body text.
    const match=/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(note.content);
    let content=note.content;
    if(match){const yaml=YAML.parseDocument(match[1]);if(!yaml.errors.length){yaml.set('title',String(name).trim());content='---\n'+yaml.toString()+'---\n'+note.content.slice(match[0].length);}}
    const oldHeading='# '+note.title;content=content.split('\n').map((line,index,lines)=>line===oldHeading&&lines.indexOf(oldHeading)===index?'# '+String(name).trim():line).join('\n');
    if(path.dirname(source)!==path.dirname(destination))content=rebaseLinks(content,path.dirname(source),path.dirname(destination));
    if(content!==note.content){const backup=path.join(this.root,'.pdfsandwich','history',slug(id),`${Date.now()}-rename.md`);atomic(backup,note.content);atomic(source,content);}
    fs.renameSync(source, destination);
    this.associations.register(destination,note.id,note.documentId);
    this.onChange({ type: 'notes-changed' }); this.scan();
    return [...this.index.values()].find(n => n.relative === path.relative(this.root, destination));
  }
  appendExcerpt({ noteId, document, page, annotationId, rects = [], source = '', translation = '', thought = '', bilingual = true, attachment, latex }) {
    if (!Number.isSafeInteger(page) || page < 0 || page >= document.pages) throw new Error('无效摘录页码。');
    const note = noteId ? this.get(noteId) : this.create({ document });
    if (note.documentId && note.documentId !== document.id) throw new Error('请将摘录加入当前文献的笔记。');
    const fingerprint = hash(JSON.stringify([document.id, page, annotationId || rects, source.trim(), attachment || '', latex || ''])).slice(0, 24);
    const marker = `<!-- pdfsandwich:excerpt:${fingerprint} -->`;
    if (note.content.includes(marker)) return { note, excerptId: fingerprint, duplicate: true };
    const quote = value => String(value).trim().split(/\r?\n/).map(line => '> ' + line).join('\n');
    const relativeAttachment=attachment?path.relative(path.dirname(this.resolve(note.relative)),this.attachmentPath(attachment)).replace(/\\/g,'/'):'';
    const excerpt = `\n\n${marker}\n### [第 ${page + 1} 页](${sourceLink(document.id, page, annotationId, rects[0])})\n\n${source ? quote(source) + '\n\n' : ''}${bilingual && translation ? quote(translation) + '\n\n' : ''}${attachment ? `![摘录截图](<${relativeAttachment}>)\n\n` : ''}${latex ? `$$\n${latex}\n$$\n\n` : ''}${thought ? `**个人想法**\n\n${thought}\n\n` : ''}^pdfsandwich-${fingerprint}\n`;
    const saved = this.save({ id: note.id, content: note.content + excerpt, version: note.version, base: note.content });
    return { note: saved.note, excerptId: fingerprint, duplicate: false };
  }
  attachment(documentId, bytes, noteId) {
    if (!/^[\w-]+$/.test(documentId) || bytes.length > 30 * 1024 * 1024 || !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('无效截图。');
    const relativeNote=noteId?this.get(noteId).relative:'';
    const directory=this.attachmentDirectory(relativeNote);
    const file=this.config.mode==='obsidian'?path.join(directory,`pdfsandwich-${documentId}-${hash(bytes).slice(0,24)}.png`):path.join(directory,documentId,hash(bytes).slice(0,24)+'.png');
    if(fs.existsSync(file)&&hash(fs.readFileSync(file))!==hash(bytes))throw new Error('同名截图已被外部修改，已保留原文件。');
    if (!fs.existsSync(file)) atomic(file, bytes); return path.relative(this.root,file);
  }
  pasteImage(noteId,bytes,content) {
    if(bytes.length>30*1024*1024||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw new Error('无效图片或图片超过 30 MB。');
    const note=this.get(noteId);
    if(typeof content==='string'&&content.length<=5_000_000)note.content=content;
    const directory=this.attachmentDirectory(note.relative);
    const {naming,writeImage}=require('./image-naming.cjs');
    const file=writeImage(directory,bytes,naming(this.config,note,parse(note.content).meta));
    const relative=path.relative(path.dirname(this.resolve(note.relative)),file).replace(/\\/g,'/');
    return {markdown:`![](<${relative}>)`,name:path.basename(file)};
  }
}
module.exports = { NotesStore, sourceLink, decodeLink, mergeAppend, parse, within, atomic };
