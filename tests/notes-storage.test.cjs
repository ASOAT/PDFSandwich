const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {NotesStore}=require('../electron/notes.cjs');

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-notes-storage-'));
  const configFile=path.join(root,'profile','notes-settings.json'),preferred=path.join(root,'program','Notes'),fallback=path.join(root,'profile','Notes');
  const stores=[];
  t.after(()=>{for(const store of stores)store.dispose();fs.rmSync(root,{recursive:true,force:true});});
  const open=()=>{const store=new NotesStore(configFile,preferred,()=>{},{fallbackRoot:fallback});stores.push(store);return store;};
  const config=value=>{fs.mkdirSync(path.dirname(configFile),{recursive:true});fs.writeFileSync(configFile,JSON.stringify(value));};
  return {root,configFile,preferred,fallback,open,config};
}
function denyWrites(t,directory,code='EPERM'){
  const original=fs.openSync;
  t.mock.method(fs,'openSync',function(file,...args){
    const relative=path.relative(directory,String(file));
    if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))){
      throw Object.assign(new Error('Denied test directory'),{code});
    }
    return original.call(this,file,...args);
  });
}

test('fresh and previously configured empty default Notes fall back and persist',t=>{
  const f=fixture(t);fs.mkdirSync(f.preferred,{recursive:true});
  f.config({mode:'standalone',standaloneRoot:f.preferred,notesFolder:'Papers'});
  denyWrites(t,f.preferred);
  const store=f.open();assert.equal(store.root,f.fallback);
  const note=store.create({title:'A new note'});
  assert.ok(fs.existsSync(path.join(f.fallback,note.relative)));
  assert.equal(JSON.parse(fs.readFileSync(f.configFile,'utf8')).standaloneRoot,f.fallback);
  store.dispose();const reopened=f.open();assert.equal(reopened.get(note.id).title,'A new note');
  assert.deepEqual(fs.readdirSync(f.preferred),[]);
});

test('missing program Notes directory falls back on mkdir permission failure',t=>{
  const f=fixture(t),original=fs.mkdirSync;
  t.mock.method(fs,'mkdirSync',function(folder,...args){
    if(path.resolve(folder)===f.preferred)throw Object.assign(new Error('No installation write access'),{code:'EACCES'});
    return original.call(this,folder,...args);
  });
  const store=f.open();assert.equal(store.root,f.fallback);assert.equal(fs.existsSync(f.preferred),false);
});

test('writable default Notes remains beside the program',t=>{
  const f=fixture(t),store=f.open();assert.equal(store.root,f.preferred);
  const note=store.create({title:'Keep my default'});
  assert.ok(fs.existsSync(path.join(f.preferred,note.relative)));
  assert.equal(fs.existsSync(f.fallback),false);
});

test('existing default notes never silently switch to an empty library',t=>{
  const f=fixture(t);fs.mkdirSync(f.preferred,{recursive:true});
  fs.writeFileSync(path.join(f.preferred,'Existing.md'),'My own notes');
  f.config({mode:'standalone',standaloneRoot:f.preferred});const before=fs.readFileSync(f.configFile,'utf8');
  denyWrites(t,f.preferred);
  assert.throws(()=>f.open(),/已有笔记保持原位置/);
  assert.equal(fs.readFileSync(path.join(f.preferred,'Existing.md'),'utf8'),'My own notes');
  assert.equal(fs.readFileSync(f.configFile,'utf8'),before);assert.equal(fs.existsSync(f.fallback),false);
});

test('chosen standalone folder and Obsidian Vault do not fall back',t=>{
  const f=fixture(t),chosen=path.join(f.root,'chosen'),vault=path.join(f.root,'vault');
  fs.mkdirSync(chosen);fs.mkdirSync(vault);
  denyWrites(t,chosen);
  f.config({mode:'standalone',standaloneRoot:chosen});let before=fs.readFileSync(f.configFile,'utf8');
  assert.throws(()=>f.open(),/没有写入权限/);assert.equal(fs.readFileSync(f.configFile,'utf8'),before);
  denyWrites(t,vault);
  f.config({mode:'obsidian',vault,notesFolder:'Research'});before=fs.readFileSync(f.configFile,'utf8');
  assert.throws(()=>f.open(),/没有写入权限/);assert.equal(fs.readFileSync(f.configFile,'utf8'),before);
  assert.equal(fs.existsSync(f.fallback),false);
});

test('selecting an unwritable folder preserves current notes and config',t=>{
  const f=fixture(t),store=f.open(),note=store.create({title:'Existing'}),chosen=path.join(f.root,'chosen');
  store.configure({standaloneRoot:f.preferred});const before=fs.readFileSync(f.configFile,'utf8');
  denyWrites(t,chosen);
  assert.throws(()=>store.configure({standaloneRoot:chosen}),/没有写入权限/);
  assert.equal(store.root,f.preferred);assert.equal(store.get(note.id).title,'Existing');
  assert.equal(fs.readFileSync(f.configFile,'utf8'),before);
});

test('disk-full failures are not treated as installation permissions',t=>{
  const f=fixture(t);denyWrites(t,f.preferred,'ENOSPC');
  assert.throws(()=>f.open(),error=>error.code==='ENOSPC');
  assert.equal(fs.existsSync(f.fallback),false);
});
