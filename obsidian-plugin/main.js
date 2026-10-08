const {Plugin,PluginSettingTab,Setting,Notice,normalizePath,TFile,FuzzySuggestModal}=require('obsidian');
const SHARED='.pdfsandwich/config.json',INDEX='.pdfsandwich/notes-index.json';
const valid=p=>typeof p==='string'&&p.length>0&&!/^(?:[a-z]:|[\\/])/i.test(p)&&!p.split(/[\\/]/).some(x=>x==='..'||x.startsWith('.'));
module.exports=class PDFSandwichCompanion extends Plugin {
  async onload(){
    this.settings={version:1,notesFolder:'Papers',templateFile:''};this.notes={};
    await this.readSettings();await this.readIndex();
    this.addSettingTab(new SettingsTab(this.app,this));
    this.addCommand({id:'open-pdf',name:'Open associated PDF in PDFSandwich',checkCallback:checking=>{
      const id=this.documentId(this.app.workspace.getActiveFile());if(!id)return false;
      if(!checking)this.openDocument(id);return true;
    }});
    this.addCommand({id:'open-notes-folder',name:'Show literature notes',callback:()=>{
      const files=this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(this.settings.notesFolder+'/'));
      if(files[0])this.app.workspace.getLeaf(false).openFile(files[0]);else new Notice('No literature notes in '+this.settings.notesFolder);
    }});
    this.registerObsidianProtocolHandler('pdfsandwich',async params=>{
      if(typeof params.note!=='string')return;await this.readIndex();
      const target=this.notes[params.note]?.path;
      const file=this.app.vault.getMarkdownFiles().find(f=>f.path===target||this.app.metadataCache.getFileCache(f)?.frontmatter?.pdfsandwich_note_id===params.note);
      if(file)await this.app.workspace.getLeaf(false).openFile(file);else new Notice('PDFSandwich note not found in this vault.');
    });
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
      if(!(file instanceof TFile))return;const id=this.documentId(file);
      if(id)menu.addItem(item=>item.setTitle('Open in PDFSandwich').setIcon('book-open').onClick(()=>this.openDocument(id)));
    }));
    this.registerEvent(this.app.vault.on('rename',async(file,oldPath)=>{
      await this.readIndex();let changed=false;
      for(const record of Object.values(this.notes))if(record.path===oldPath||record.path.startsWith(oldPath+'/')){record.path=file.path+record.path.slice(oldPath.length);changed=true;}
      if(changed)await this.app.vault.adapter.write(INDEX,JSON.stringify({version:1,notes:this.notes},null,2));
    }));
    this.registerInterval(window.setInterval(async()=>{await this.readSettings();await this.readIndex();},3000));
  }
  documentId(file){
    if(!file)return null;const id=Object.values(this.notes).find(n=>n.path===file.path)?.documentId||this.app.metadataCache.getFileCache(file)?.frontmatter?.pdfsandwich_document_id;
    return typeof id==='string'&&/^[\w-]+$/.test(id)?id:null;
  }
  openDocument(id){window.open('pdfsandwich://document/'+encodeURIComponent(id)+'?page=1');}
  async readIndex(){try{if(await this.app.vault.adapter.exists(INDEX))this.notes=JSON.parse(await this.app.vault.adapter.read(INDEX)).notes||{};}catch(error){console.warn('PDFSandwich index could not be read',error.message);}}
  async readSettings(){
    try{if(await this.app.vault.adapter.exists(SHARED)){
      const text=await this.app.vault.adapter.read(SHARED);if(text===this.lastConfig)return;
      const config=JSON.parse(text);if(valid(config.notesFolder)){this.settings={...config,templateFile:config.templateFile||''};this.lastConfig=text;}
    }}catch(error){console.warn('PDFSandwich settings could not be read',error.message);}
  }
  async saveSettings(changes){
    if(!await this.app.vault.adapter.exists('.pdfsandwich'))await this.app.vault.adapter.mkdir('.pdfsandwich');
    await this.readSettings();const next={...this.settings,...changes,version:1},text=JSON.stringify(next,null,2);
    await this.app.vault.adapter.write(SHARED,text);this.settings=next;this.lastConfig=text;return true;
  }
  async saveFolder(folder){
    folder=normalizePath(folder.trim());if(!valid(folder)){new Notice('Choose a folder inside this vault.');return false;}
    const changed=folder!==this.settings.notesFolder;await this.saveSettings({notesFolder:folder});
    if(changed)new Notice('Notes folder updated. Existing files stay in their current folder; migrate them from PDFSandwich if needed.');return true;
  }
  async saveTemplate(file){
    if(file&&(!valid(file)||!file.toLowerCase().endsWith('.md')||!this.app.vault.getMarkdownFiles().some(f=>f.path===file))){new Notice('Choose an existing Markdown template in this vault.');return false;}
    return this.saveSettings({templateFile:file});
  }
};
class TemplatePicker extends FuzzySuggestModal{
  constructor(app,choose){super(app);this.choose=choose;this.setPlaceholder('选择文献笔记模板 / Choose a template');}
  getItems(){return this.app.vault.getMarkdownFiles();}
  getItemText(file){return file.path;}
  onChooseItem(file){this.choose(file.path);}
}
class SettingsTab extends PluginSettingTab{
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){
    const {containerEl}=this;containerEl.empty();containerEl.createEl('h2',{text:'PDFSandwich'});let folder=this.plugin.settings.notesFolder;
    new Setting(containerEl).setName('文献笔记文件夹 / Notes folder').setDesc('Vault 内的路径，与 PDFSandwich 共用。修改后不会移动已有笔记。').addText(text=>text.setPlaceholder('Papers').setValue(folder).onChange(value=>folder=value)).addButton(button=>button.setButtonText('应用').setCta().onClick(async()=>{if(await this.plugin.saveFolder(folder))this.display();}));
    new Setting(containerEl).setName('文献笔记模板 / Template').setDesc(this.plugin.settings.templateFile||'未选择模板：新建笔记为空文件。')
      .addButton(button=>button.setButtonText('选择模板').onClick(()=>new TemplatePicker(this.app,async file=>{if(await this.plugin.saveTemplate(file))this.display();}).open()))
      .addButton(button=>button.setButtonText('清除').onClick(async()=>{await this.plugin.saveTemplate('');this.display();}));
    containerEl.createEl('p',{text:'模板只用于新笔记，不会覆盖已有内容。支持 {{title}}、{{authors}}、{{year}}、{{doi}}、{{abstract}}、{{url}}、{{date}}、{{time}}；日期支持 YYYY、MM、DD，时间支持 HH、mm、ss。不执行 Templater 脚本。'});
    containerEl.createEl('p',{text:'图片使用 Obsidian 的附件目录设置。文献关联保存在 Vault 的 .pdfsandwich 索引中，Markdown 无需内部编号。'});
  }
}
