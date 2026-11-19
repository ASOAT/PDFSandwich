const fs=require('node:fs/promises');
const path=require('node:path');
// Only app-created session children are disposable. Reading drafts live elsewhere.
class ReadingSessions {
  constructor(userDirectory){this.root=path.resolve(userDirectory,'zotero-reading');}
  async create(){await fs.mkdir(this.root,{recursive:true});return fs.mkdtemp(path.join(this.root,'session-'));}
  async remove(directory){
    if(path.dirname(path.resolve(directory))!==this.root||!/^session-[\w-]+$/.test(path.basename(directory)))throw new Error('无效临时会话路径。');
    try{const stat=await fs.lstat(directory);if(stat.isSymbolicLink())await fs.unlink(directory);else await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  async sweep(){
    let entries;try{entries=await fs.readdir(this.root);}catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const name of entries)if(/^session-[\w-]+$/.test(name))await this.remove(path.join(this.root,name));
  }
}
module.exports={ReadingSessions};
