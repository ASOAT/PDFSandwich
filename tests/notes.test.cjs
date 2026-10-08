const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { NotesStore, sourceLink, decodeLink } = require('../electron/notes.cjs');
function fixture(t) { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfsandwich-notes-')); const store = new NotesStore(path.join(root,'config.json'), path.join(root,'Notes')); t.after(() => { store.dispose(); fs.rmSync(root,{recursive:true,force:true}); }); return { root, store }; }
function seeded(store,options={}){const note=store.create(options);return store.save({id:note.id,version:note.version,base:note.content,content:'# '+note.title+'\n\n## 个人思考\n'}).note;}
const doc = { id:'document-uuid', title:'Example study', authors:'Alice; Bob', year:'2026', pages:12, tags:['AI'] };
test('one document one note, excerpts deduplicate and resolve exact source', t => {
  const {store}=fixture(t), note=store.create({document:doc});
  assert.equal(store.create({document:doc}).id,note.id);
  const args={document:doc,page:3,source:'A finding',translation:'结论',rects:[[10,20,200,40]],thought:'My interpretation'};
  const first=store.appendExcerpt(args), second=store.appendExcerpt(args);
  assert.equal(second.duplicate,true); assert.equal(first.excerptId,second.excerptId);
  assert.match(second.note.content,/My interpretation/); assert.match(second.note.content,/结论/);
  assert.deepEqual(decodeLink(sourceLink(doc.id,3,'mark-1',[10,20,200,40])),{documentId:doc.id,page:3,annotationId:'mark-1',rect:[10,20,200,40]});
  assert.throws(()=>decodeLink('pdfsandwich://file/C:/secret'));
});
test('simultaneous handwritten edit and appended excerpt merge; overlap preserves recovery', t => {
  const {store}=fixture(t), note=seeded(store,{document:doc});
  store.appendExcerpt({document:doc,page:0,source:'External excerpt'});
  const edited=note.content.replace('## 个人思考','## 个人思考\n\nMy own idea');
  const result=store.save({id:note.id,base:note.content,version:note.version,content:edited});
  assert.equal(result.conflict,false); assert.match(result.note.content,/My own idea/); assert.match(result.note.content,/External excerpt/);
  const base=result.note;
  fs.writeFileSync(store.resolve(base.relative),base.content.replace('My own idea','Obsidian edit'));
  const conflict=store.save({id:base.id,version:base.version,base:base.content,content:base.content.replace('My own idea','Reader edit')});
  assert.equal(conflict.conflict,true); assert.match(fs.readFileSync(conflict.recovery,'utf8'),/Reader edit/);
  assert.match(store.get(base.id).content,/Obsidian edit/);
});
test('migration retains originals, rejects collisions and traversal; rename keeps association', t => {
  const {store,root}=fixture(t), note=store.create({document:doc}), original=store.resolve(note.relative);
  assert.throws(()=>store.create({title:'escape',category:'../outside'}));
  const moved=store.rename({id:note.id,name:'Renamed',category:'Methods'});
  assert.equal(moved.id,note.id); assert.equal(moved.documentId,doc.id);
  const source=store.resolve(moved.relative), target=path.join(root,'Other');
  store.configure({standaloneRoot:target},true);
  assert.equal(fs.existsSync(source),true); assert.equal(store.get(note.id).category,'Methods'); assert.equal(fs.existsSync(original),false);
  const collision=path.join(root,'Collision'); fs.mkdirSync(path.join(collision,'Methods'),{recursive:true}); fs.writeFileSync(path.join(collision,'Methods','Renamed.md'),'precious');
  assert.throws(()=>store.configure({standaloneRoot:collision},true),/已有/); assert.equal(store.root,target);
});
test('Obsidian folder configuration propagates both ways without moving handwritten notes', async t => {
  const {store,root}=fixture(t), vault=path.join(root,'Vault'); fs.mkdirSync(vault);
  store.configure({mode:'obsidian',vault,notesFolder:'Reading'});
  const note=store.create({document:doc});
  fs.writeFileSync(path.join(vault,'.pdfsandwich','config.json'),JSON.stringify({version:1,notesFolder:'Research'}));
  await new Promise(resolve=>setTimeout(resolve,600));
  assert.equal(store.settings().notesFolder,'Research'); assert.equal(store.root,path.join(vault,'Research'));
  assert.equal(fs.existsSync(path.join(vault,'Reading',note.relative)),true);
  assert.throws(()=>store.configure({notesFolder:'../escape'}));
});

test('categorized notes keep screenshot references through renaming and migration', t => {
  const {store,root}=fixture(t),note=seeded(store,{document:doc,category:'Research'});
  const png=Buffer.from('89504e470d0a1a0a','hex');
  const attachment=store.attachment(doc.id,png);
  const saved=store.appendExcerpt({document:doc,page:1,attachment,source:'A diagram'}).note;
  assert.match(saved.content,/\.\.\/assets\//);
  const renamed=store.rename({id:note.id,name:'New title',category:'Research/Methods'});
  assert.equal(renamed.title,'New title');assert.match(renamed.content,/# New title/);
  const target=/!\[摘录截图\]\(<([^>]+)>\)/.exec(renamed.content)[1];
  assert.match(target,/^\.\.\/\.\.\/assets\//);
  assert.deepEqual(fs.readFileSync(store.resolve(path.join(renamed.category,target),true)),png);
  store.configure({standaloneRoot:path.join(root,'Moved Notes')},true);
  assert.deepEqual(fs.readFileSync(store.resolve(path.join(renamed.category,target),true)),png);
});

test('save checks actual file content even when an external editor preserves size and timestamps', t=>{
  const {store}=fixture(t),created=seeded(store,{document:doc}),file=store.resolve(created.relative);
  fs.utimesSync(file,1,1);const note=store.get(created.id);
  const external=note.content.replace('Example study','Changed title');assert.equal(external.length,note.content.length);
  fs.writeFileSync(file,external);fs.utimesSync(file,1,1);
  const saved=store.save({id:note.id,base:note.content,version:note.version,content:note.content.replace('Example study','Reader change')});
  assert.equal(saved.conflict,true);assert.equal(fs.readFileSync(file,'utf8'),external);
});

test('Obsidian captures follow native attachment settings and survive migration to independent Notes',t=>{
  const {store,root}=fixture(t),vault=path.join(root,'Vault');fs.mkdirSync(path.join(vault,'.obsidian'),{recursive:true});
  const appSettings=path.join(vault,'.obsidian','app.json');fs.writeFileSync(appSettings,JSON.stringify({attachmentFolderPath:'99System/Attachments'}));
  store.configure({mode:'obsidian',vault,notesFolder:'03Literature'});
  const note=store.create({document:doc}),png=Buffer.from('89504e470d0a1a0a','hex');
  const attachment=store.attachment(doc.id,png,note.id),file=store.attachmentPath(attachment);
  assert.equal(path.dirname(file),path.join(vault,'99System','Attachments'));
  const saved=store.appendExcerpt({noteId:note.id,document:doc,page:0,source:'Figure',attachment}).note;
  assert.match(saved.content,/\.\.\/99System\/Attachments\//);
  fs.writeFileSync(appSettings,JSON.stringify({attachmentFolderPath:'./Figures'}));
  const next=store.attachment(doc.id,Buffer.concat([png,Buffer.from('other')]),note.id);
  assert.equal(path.dirname(store.attachmentPath(next)),path.join(vault,'03Literature','Figures'));
  store.configure({mode:'standalone',standaloneRoot:path.join(root,'Independent')},true);
  const migrated=store.get(note.id),link=/!\[摘录截图\]\(<([^>]+)>\)/.exec(migrated.content)[1];
  assert.deepEqual(fs.readFileSync(store.attachmentPath(link,migrated.relative)),png);
  assert.equal(fs.existsSync(file),true);assert.equal(migrated.documentId,doc.id);
  assert.equal(fs.readFileSync(path.join(vault,'03Literature',note.relative),'utf8'),saved.content);
});


test('empty notes retain stable IDs without YAML through restart and external rename',t=>{
  const {store,root}=fixture(t),note=store.create({document:doc});assert.equal(note.content,'');
  const file=store.resolve(note.relative),renamed=store.resolve('External name.md');fs.renameSync(file,renamed);
  assert.equal(store.get(note.id).documentId,doc.id);assert.equal(store.get(note.id).relative,'External name.md');
  store.dispose();const restarted=new NotesStore(path.join(root,'config.json'),path.join(root,'Notes'));t.after(()=>restarted.dispose());
  assert.equal(restarted.create({document:doc}).id,note.id);
  const other=restarted.create({title:'Unrelated'});assert.notEqual(other.id,note.id);assert.equal(other.documentId,'');
});

test('legacy IDs move to shared index with backup; other YAML and prose stay intact',t=>{
  const {store}=fixture(t),content='---\npdfsandwich_note_id: legacy-id\npdfsandwich_document_id: document-uuid\ntitle: Custom title\ntags: [one, two]\n# custom comment\n---\nHandwritten content\n';
  fs.writeFileSync(store.resolve('Legacy.md'),content);const note=store.get('legacy-id');
  assert.equal(note.documentId,doc.id);assert.doesNotMatch(note.content,/pdfsandwich_(?:note|document)_id/);assert.match(note.content,/tags: \[one, two\]/);assert.match(note.content,/# custom comment/);assert.match(note.content,/Handwritten content/);
  const backup=fs.readdirSync(path.join(store.root,'.pdfsandwich','history','legacy-id'))[0];assert.equal(fs.readFileSync(path.join(store.root,'.pdfsandwich','history','legacy-id',backup),'utf8'),content);
  const saved=store.save({id:note.id,version:note.version,base:note.content,content:'Only my own text'}).note;assert.equal(saved.documentId,doc.id);
});

test('Obsidian templates apply only to new notes; settings preserve chosen template',async t=>{
  const {store,root}=fixture(t),vault=path.join(root,'Vault');fs.mkdirSync(path.join(vault,'Templates'),{recursive:true});
  fs.writeFileSync(path.join(vault,'Templates','Paper.md'),'---\ntitle: "{{title}}"\nyear: "{{year}}"\n---\n# {{title}}\n{{authors}}\n{{abstract}}\n{{date:YYYY-MM-DD}}\n');
  store.configure({mode:'obsidian',vault,notesFolder:'03Literature',templateFile:'Templates/Paper.md'});
  const note=store.create({document:doc});assert.match(note.content,/# Example study/);assert.match(note.content,/Alice; Bob/);assert.doesNotMatch(note.content,/pdfsandwich_note_id|研究方法/);
  store.configure({notesFolder:'03Literature'});assert.equal(store.settings().templateFile,'Templates/Paper.md');
  fs.writeFileSync(path.join(vault,'.pdfsandwich','config.json'),JSON.stringify({version:1,notesFolder:'03Literature',templateFile:''}));
  await new Promise(r=>setTimeout(r,650));assert.equal(store.create({title:'Blank'}).content,'');assert.equal(store.get(note.id).content,note.content);
  store.configure({templateFile:'../secret.md'});assert.throws(()=>store.create({title:'Invalid'}),/文件夹|Vault/);
});
