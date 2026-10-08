const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('companion shares folder settings, validates paths and opens stable document and note links',async()=>{
  const files=new Map([['.pdfsandwich/config.json',JSON.stringify({version:1,notesFolder:'Research'})]]),opened=[],notices=[],intervals=[];
  const note={path:'Research/example.md'};
  const adapter={exists:async p=>files.has(p),read:async p=>files.get(p),write:async(p,s)=>files.set(p,s),mkdir:async p=>files.set(p,'')};
  class Plugin{constructor(app){this.app=app;this.commands=[];}addSettingTab(){}addCommand(c){this.commands.push(c);}registerObsidianProtocolHandler(name,fn){this.protocol=fn;}registerEvent(){}registerInterval(){}}
  const app={vault:{adapter,getMarkdownFiles:()=>[note]},workspace:{getActiveFile:()=>note,getLeaf:()=>({openFile:async file=>opened.push(file.path)}),on:()=>{}},metadataCache:{getFileCache:()=>({frontmatter:{pdfsandwich_document_id:'document-123',pdfsandwich_note_id:'note-123'}})}};
  const context={module:{exports:{}},require:()=>({Plugin,PluginSettingTab:class{},Setting:class{},Notice:class{constructor(value){notices.push(value);}},normalizePath:p=>p.replace(/\\/g,'/'),TFile:class{}}),window:{setInterval:fn=>intervals.push(fn),open:link=>opened.push(link)},console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../obsidian-plugin/main.js'),'utf8'),context);
  const plugin=new context.module.exports(app);await plugin.onload();assert.equal(plugin.settings.notesFolder,'Research');
  assert.equal(await plugin.saveFolder('../escape'),false);assert.equal(await plugin.saveFolder('Reading/Papers'),true);
  assert.equal(JSON.parse(files.get('.pdfsandwich/config.json')).notesFolder,'Reading/Papers');
  files.set('.pdfsandwich/config.json',JSON.stringify({version:1,notesFolder:'FromReader'}));await intervals[0]();assert.equal(plugin.settings.notesFolder,'FromReader');
  assert.equal(plugin.commands[0].checkCallback(true),true);plugin.commands[0].checkCallback(false);assert.equal(opened[0],'pdfsandwich://document/document-123?page=1');
  await plugin.protocol({note:'note-123'});assert.equal(opened[1],note.path);
});
