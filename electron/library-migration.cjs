const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {atomic,within}=require('./notes.cjs');
const documentId=file=>crypto.createHash('sha256').update(path.resolve(file).toLowerCase()).digest('hex').slice(0,24);
function migrateEnglishLibrary(library,userDir) {
  const oldRoot=path.resolve(library.data.storageRoot);
  if(path.basename(oldRoot)!=='文献库')return [];
  const target=path.join(path.dirname(oldRoot),'Library');
  if(fs.existsSync(target))throw new Error('Library 文件夹已存在，未移动旧文献库。请在存储设置中检查目录。');
  if(fs.existsSync(oldRoot)&&fs.lstatSync(oldRoot).isSymbolicLink())throw new Error('文献库为联接目录，未自动重命名。');
  const original=structuredClone(library.data),changes=[];
  const replace=file=>typeof file==='string'&&within(oldRoot,path.resolve(file))?path.join(target,path.relative(oldRoot,file)):file;
  let moved=false;const drafts=[],written=[];
  try {
    library.data.storageRoot=target;
    for(const item of library.data.documents){
      const previous=item.path,next=replace(previous);if(next===previous)continue;
      item.path=next;if(item.translationPath)item.translationPath=replace(item.translationPath);
      const draft=path.join(userDir,'documents',documentId(previous),'draft.json');
      if(fs.existsSync(draft)){
        const content=JSON.parse(fs.readFileSync(draft,'utf8'));
        if(content.translationFile?.path)content.translationFile.path=replace(content.translationFile.path);
        const destination=path.join(userDir,'documents',documentId(next),'draft.json');
        if(fs.existsSync(destination))throw new Error('迁移目标已有阅读记录，已保留原文献库。');
        drafts.push({destination,content});
      }
      changes.push({from:previous,to:next});
    }
    // Finish all conflict checks before changing either directory or draft files.
    if(fs.existsSync(oldRoot)){fs.renameSync(oldRoot,target);moved=true;}
    for(const {destination,content} of drafts){atomic(destination,JSON.stringify(content,null,2));written.push(destination);}
    library.save();return changes;
  }catch(error){library.data=original;for(const file of written)if(fs.existsSync(file))fs.unlinkSync(file);if(moved)fs.renameSync(target,oldRoot);throw error;}
}
module.exports={migrateEnglishLibrary,documentId};
