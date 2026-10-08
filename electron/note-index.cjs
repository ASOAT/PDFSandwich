const fs = require('node:fs');
const path = require('node:path');
const {randomUUID, createHash} = require('node:crypto');

// Associations live beside the notes, never inside the user's Markdown.
class NoteIndex {
  constructor(root) { this.root=path.resolve(root);this.file=path.join(this.root,'.pdfsandwich','notes-index.json');this.reload(); }
  reload() {
    this.records=Object.assign(Object.create(null),fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')).notes||{}:{});
    this.pending=Object.create(null);
  }
  relative(file) { return path.relative(this.root,file).replace(/\\/g,'/'); }
  existing(record) { const p=path.resolve(this.root,record.path);return !path.relative(this.root,p).startsWith('..')&&fs.existsSync(p); }
  identify(file,stat,content,legacy={}) {
    const relative=this.relative(file), identity=stat.ino?`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`:'',digest=createHash('sha256').update(content).digest('hex');
    let match=Object.entries(this.records).find(([,v])=>v.path===relative);
    if(!match){
      const moved=Object.entries(this.records).filter(([,v])=>!this.existing(v));
      const sameFile=moved.filter(([,v])=>identity&&v.identity===identity);
      const sameContent=moved.filter(([,v])=>content.length>0&&v.hash===digest&&v.modified===stat.mtimeMs);
      match=sameFile.length===1?sameFile[0]:sameContent.length===1?sameContent[0]:null;
    }
    const validId=value=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
    const id=match?.[0]||(validId(legacy.pdfsandwich_note_id)?legacy.pdfsandwich_note_id:randomUUID());
    const record={path:relative,documentId:match?.[1].documentId||(validId(legacy.pdfsandwich_document_id)?legacy.pdfsandwich_document_id:''),identity,hash:digest,modified:stat.mtimeMs};
    if(JSON.stringify(this.records[id])!==JSON.stringify(record)){this.records[id]=record;this.pending[id]=record;}
    return {id,documentId:record.documentId};
  }
  register(file,id,documentId='') {
    const stat=fs.statSync(file),content=fs.readFileSync(file);
    const record={path:this.relative(file),documentId,identity:stat.ino?`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`:'',hash:createHash('sha256').update(content).digest('hex'),modified:stat.mtimeMs};
    this.records[id]=record;this.pending[id]=record;this.flush();
  }
  flush() {
    if(!Object.keys(this.pending).length)return;
    const latest=Object.assign(Object.create(null),fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')).notes||{}:{});
    for(const [id,record] of Object.entries(this.pending)){
      for(const [other,value] of Object.entries(latest))if(other!==id&&value.path===record.path)delete latest[other];
      latest[id]=record;
    }
    fs.mkdirSync(path.dirname(this.file),{recursive:true});const temp=this.file+'.'+randomUUID()+'.tmp';
    try{fs.writeFileSync(temp,JSON.stringify({version:1,notes:latest},null,2),{flag:'wx'});fs.renameSync(temp,this.file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
    this.records=latest;this.pending=Object.create(null);
  }
}
module.exports={NoteIndex};
