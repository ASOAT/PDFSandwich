const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Library}=require('../electron/library.cjs');const {migrateEnglishLibrary,documentId}=require('../electron/library-migration.cjs');
test('English library rename preserves IDs, PDF bytes and drafts',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-migration-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old=path.join(root,'文献库'),file=path.join(old,'uuid','book.pdf');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'PDF bytes');
  const library=new Library(path.join(root,'library.json'),old);const item=library.upsert({path:file,pages:3,size:9});item.managed=true;library.save();
  const draft=path.join(root,'documents',documentId(file),'draft.json');fs.mkdirSync(path.dirname(draft),{recursive:true});fs.writeFileSync(draft,JSON.stringify({annotations:[{id:'important'}],translationFile:{path:file.replace('.pdf','.zh.pdf')},translations:{0:{path:'unchanged cache'}}}));
  const changes=migrateEnglishLibrary(library,root),next=changes[0].to;assert.equal(library.get(item.id).path,next);assert.equal(fs.readFileSync(next,'utf8'),'PDF bytes');
  const saved=JSON.parse(fs.readFileSync(path.join(root,'documents',documentId(next),'draft.json')));assert.equal(saved.annotations[0].id,'important');assert.equal(saved.translations[0].path,'unchanged cache');assert.ok(saved.translationFile.path.includes('Library'));assert.deepEqual(migrateEnglishLibrary(library,root),[]);
});

test('a later draft collision leaves the library and all earlier drafts unchanged',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-migration-conflict-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const old=path.join(root,'文献库'),library=new Library(path.join(root,'library.json'),old),files=[];
  for(const name of ['first','second']){
    const file=path.join(old,name,'book.pdf');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,name);files.push(file);
    library.upsert({path:file,pages:1,size:name.length});
    const draft=path.join(root,'documents',documentId(file),'draft.json');fs.mkdirSync(path.dirname(draft),{recursive:true});fs.writeFileSync(draft,'{}');
  }
  const destination=file=>path.join(root,'documents',documentId(path.join(root,'Library',path.relative(old,file))),'draft.json');
  fs.mkdirSync(path.dirname(destination(files[1])),{recursive:true});fs.writeFileSync(destination(files[1]),'precious draft');
  assert.throws(()=>migrateEnglishLibrary(library,root),/已有阅读记录/);
  assert.equal(fs.existsSync(old),true);assert.equal(fs.existsSync(path.join(root,'Library')),false);
  assert.equal(fs.existsSync(destination(files[0])),false);assert.equal(fs.readFileSync(destination(files[1]),'utf8'),'precious draft');
  assert.equal(library.data.storageRoot,old);
});
