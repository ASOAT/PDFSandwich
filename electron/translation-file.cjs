const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function availableTranslationPath(source) {
  const stem=source.replace(/\.pdf$/i,'');
  for(let i=0;i<10000;i++) { const file=`${stem}.zh${i?` (${i+1})`:''}.pdf`; if(!fs.existsSync(file))return file; }
  throw new Error('同名译文过多，请更换保存目录。');
}
function snapshotTranslation(doc) {
  const ready=Object.fromEntries(Object.entries(doc.translations).filter(([,item])=>item.status==='ready'&&item.path).map(([page,item])=>[page,item.path]));
  if(!Object.keys(ready).length)return null;
  const groups=new Map();
  for(const item of doc.annotations) { if(!groups.has(item.page))groups.set(item.page,[]); groups.get(item.page).push(item); }
  const signatures=doc.pages.map((_,index)=>{
    const file=ready[index],stat=file?fs.statSync(file):null;
    return crypto.createHash('sha256').update(JSON.stringify([doc.cacheVersion,file,stat?.size,stat?.mtimeMs,groups.get(index)||[]])).digest('hex').slice(0,24);
  });
  const previous=doc.translationFile;
  const changed=signatures.flatMap((value,index)=>value!==previous?.signatures?.[index]?[index]:[]);
  if(previous&&!changed.length) {
    if(!fs.existsSync(previous.path))throw new Error('译文文件已被移动或删除，请选择另存副本。');
    const stat=fs.statSync(previous.path,{bigint:true});
    if(String(stat.size)!==String(previous.stamp.size)||String(stat.mtimeNs)!==previous.stamp.mtime)throw new Error('译文文件被其他程序修改，未覆盖。请保留该文件并选择另存副本。');
    return null;
  }
  return { doc, signatures, count:Object.keys(ready).length, args:{source_path:doc.path,translated_pages:ready,annotations:structuredClone(doc.annotations),output:previous?.path||availableTranslationPath(doc.path),expected_source_stamp:doc.stamp,expected_output_stamp:previous?.stamp,changed_pages:changed,compact:(previous?.writes||0)%40===39} };
}
class TranslationFileSaver {
  constructor({snapshot,write,result,status,delay=1200}) { Object.assign(this,{snapshot,write,result,status,delay}); this.timer=null;this.running=null;this.pending=false; }
  request() { this.pending=true;clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;void this.flush();},this.delay); }
  cancelPending() { this.pending=false;clearTimeout(this.timer);this.timer=null; }
  async flush() {
    clearTimeout(this.timer);this.timer=null;
    if(this.running) { await this.running; if(this.pending)return this.flush(); return; }
    this.running=(async()=>{
      while(this.pending) {
        this.pending=false;let snapshot;
        try {
          snapshot=this.snapshot();if(!snapshot)continue;
          this.status(snapshot.doc,'saving');
          const output=await this.write(snapshot.args);
          this.result(snapshot,output);
        } catch(error) { this.status(snapshot?.doc,'error',error.message); }
      }
    })();
    try { await this.running; } finally { this.running=null; }
  }
}
module.exports={availableTranslationPath,snapshotTranslation,TranslationFileSaver};
