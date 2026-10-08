const {Plugin,PluginSettingTab,Setting,Notice,normalizePath,TFile}=require('obsidian');
const SHARED='.pdfsandwich/config.json';
module.exports=class PDFSandwichCompanion extends Plugin {
  async onload(){
    this.settings={version:1,notesFolder:'Papers'};
    await this.readSettings();
    this.addSettingTab(new SettingsTab(this.app,this));
    this.addCommand({id:'open-pdf',name:'Open associated PDF in PDFSandwich',checkCallback:checking=>{
      const file=this.app.workspace.getActiveFile(),meta=file&&this.app.metadataCache.getFileCache(file)?.frontmatter;
      if(!/^[\w-]+$/.test(meta?.pdfsandwich_document_id||''))return false;
      if(!checking)this.openDocument(meta.pdfsandwich_document_id);return true;
    }});
    this.addCommand({id:'open-notes-folder',name:'Show literature notes',callback:()=>{
      const files=this.app.vault.getMarkdownFiles().filter(f=>f.path.startsWith(this.settings.notesFolder+'/'));
      if(files[0])this.app.workspace.getLeaf(false).openFile(files[0]);else new Notice('No literature notes in '+this.settings.notesFolder);
    }});
    this.registerObsidianProtocolHandler('pdfsandwich',async params=>{
      if(typeof params.note!=='string')return;
      const file=this.app.vault.getMarkdownFiles().find(f=>this.app.metadataCache.getFileCache(f)?.frontmatter?.pdfsandwich_note_id===params.note);
      if(file)await this.app.workspace.getLeaf(false).openFile(file);else new Notice('PDFSandwich note not found in this vault.');
    });
    this.registerEvent(this.app.workspace.on('file-menu',(menu,file)=>{
      if(!(file instanceof TFile))return;
      const id=this.app.metadataCache.getFileCache(file)?.frontmatter?.pdfsandwich_document_id;
      if(typeof id==='string'&&/^[\w-]+$/.test(id))menu.addItem(item=>item.setTitle('Open in PDFSandwich').setIcon('book-open').onClick(()=>this.openDocument(id)));
    }));
    // Hidden configuration files are not TFiles; poll only the small shared setting.
    this.registerInterval(window.setInterval(()=>this.readSettings(),3000));
  }
  openDocument(id){window.open('pdfsandwich://document/'+encodeURIComponent(id)+'?page=1');}
  async readSettings(){
    try{if(await this.app.vault.adapter.exists(SHARED)){const text=await this.app.vault.adapter.read(SHARED);if(text===this.lastConfig)return;const config=JSON.parse(text);if(typeof config.notesFolder==='string'&&!config.notesFolder.split(/[\\/]/).some(p=>p==='..'||p.startsWith('.'))&&!/^(?:[a-z]:|[\\/])/i.test(config.notesFolder)){this.settings={version:1,notesFolder:config.notesFolder};this.lastConfig=text;}}}catch(error){console.warn('PDFSandwich settings could not be read',error.message);}
  }
  async saveFolder(folder){
    folder=normalizePath(folder.trim());if(!folder||folder.split('/').some(p=>p==='..'||p.startsWith('.'))||/^[a-z]:/i.test(folder)){new Notice('Choose a folder inside this vault.');return false;}
    const changed=folder!==this.settings.notesFolder;
    if(!await this.app.vault.adapter.exists('.pdfsandwich'))await this.app.vault.adapter.mkdir('.pdfsandwich');
    const text=JSON.stringify({version:1,notesFolder:folder},null,2);
    await this.app.vault.adapter.write(SHARED,text);this.settings.notesFolder=folder;this.lastConfig=text;
    if(changed)new Notice('Notes folder updated. Existing files stay in their current folder; migrate them from PDFSandwich if needed.');return true;
  }
};
class SettingsTab extends PluginSettingTab{
  constructor(app,plugin){super(app,plugin);this.plugin=plugin;}
  display(){const {containerEl}=this;containerEl.empty();containerEl.createEl('h2',{text:'PDFSandwich'});let folder=this.plugin.settings.notesFolder;
    new Setting(containerEl).setName('Literature notes folder').setDesc('Relative to this vault. Shared with PDFSandwich; changing this does not move or overwrite notes.').addText(text=>text.setPlaceholder('Papers').setValue(folder).onChange(value=>folder=value)).addButton(button=>button.setButtonText('Apply').setCta().onClick(async()=>{if(await this.plugin.saveFolder(folder))this.display();}));
    containerEl.createEl('p',{text:'Select this vault in PDFSandwich → Reading & notes. Both apps edit the same Markdown files. PDF excerpt links open the original passage in PDFSandwich. No account or local server is needed.'});
  }
}
