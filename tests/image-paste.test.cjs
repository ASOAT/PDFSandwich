const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {NotesStore}=require('../electron/notes.cjs');
const {naming,dateText}=require('../electron/image-naming.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('pasted images use Obsidian attachment directory, rename pattern and non-destructive numbering',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-paste-')),vault=path.join(root,'Vault'),plugin=path.join(vault,'.obsidian/plugins/obsidian-paste-image-rename');fs.mkdirSync(plugin,{recursive:true});
  fs.writeFileSync(path.join(vault,'.obsidian/community-plugins.json'),'["obsidian-paste-image-rename"]');fs.writeFileSync(path.join(vault,'.obsidian/app.json'),JSON.stringify({attachmentFolderPath:'99System/Attachments'}));
  const store=new NotesStore(path.join(root,'config.json'),path.join(root,'Notes'));t.after(()=>{store.dispose();fs.rmSync(root,{recursive:true,force:true});});store.configure({mode:'obsidian',vault,notesFolder:'03Literature'});
  const note=store.create({title:'Paper title',category:'AI'}),a=store.pasteImage(note.id,png),b=store.pasteImage(note.id,png);
  assert.equal(a.name,'Paper title.png');assert.equal(b.name,'Paper title-1.png');
  assert.ok(fs.existsSync(path.join(vault,'99System/Attachments',a.name)));assert.match(a.markdown,/\.\.\/\.\.\/99System\/Attachments/);
  assert.equal(store.get(note.id).content,''); // Only renderer inserts at the paste cursor.
  fs.writeFileSync(path.join(plugin,'data.json'),JSON.stringify({imageNamePattern:'{{frontmatter:topic}}-{{firstHeading}}',dupNumberAtStart:true,dupNumberAlways:true,dupNumberDelimiter:'_'}));
  const c=store.pasteImage(note.id,png,'---\ntopic: Matrix\n---\n# Idea');assert.equal(c.name,'1_Matrix-Idea.png');
  assert.equal(store.pasteImage(note.id,png,'---\ntopic: Matrix\n---\n# Idea').name,'2_Matrix-Idea.png');
  fs.writeFileSync(path.join(plugin,'data.json'),JSON.stringify({imageNamePattern:'../{{fileName}}'}));assert.ok(!naming(store.config,note,{}).stem.includes('/'));
  assert.throws(()=>store.pasteImage(note.id,Buffer.from('bad')),/无效/);
  store.configure({mode:'standalone'});const local=store.create({title:'Local'}),r=store.pasteImage(local.id,png);assert.match(r.markdown,/assets\//);
});
test('common plugin date tokens and literal sections are preserved',()=>assert.equal(dateText('YYYY-MM-DD [at] HHmmss',new Date(2026,9,8,7,6,5)),'2026-10-08 at 070605'));
