const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Library } = require('../electron/library.cjs');
const { removeLibraryDocuments } = require('../electron/library-removal.cjs');

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-library-removal-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const library=new Library(path.join(root,'library.json'),path.join(root,'Library'));
  const source=path.join(root,'original.pdf');fs.writeFileSync(source,'original');
  const item=library.importCopy({path:source,pages:1,size:8,title:'Example'});
  const translation=item.path.replace('.pdf','.zh.pdf');fs.writeFileSync(translation,'translation');
  library.translation(item.path,1,translation);
  const extras=['notes.md','backup.pdf','unregistered.zh.pdf'].map(name=>path.join(path.dirname(item.path),name));
  for(const file of extras)fs.writeFileSync(file,'keep');
  const recycled=[];
  const trash=async file=>{recycled.push(file);fs.renameSync(file,path.join(root,`recycled-${recycled.length}.pdf`));};
  return {root,library,source,item,translation,extras,trash,recycled};
}

test('checked removal recycles only registered managed PDFs and keeps originals, notes and backups',async t=>{
  const f=fixture(t);
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id,f.item.id],deletePdf:true},{trash:f.trash});
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.removed,[f.item.id]);
  assert.deepEqual(f.recycled,[f.translation,f.item.path]);assert.equal(result.documents.length,0);
  assert.equal(fs.readFileSync(f.source,'utf8'),'original');for(const file of f.extras)assert.equal(fs.readFileSync(file,'utf8'),'keep');
  assert.equal(new Library(f.library.file).data.documents.length,0);
});

test('unchecked or omitted deletion removes records only',async t=>{
  for(const deletePdf of [false,undefined]){
    const f=fixture(t);await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf},{trash:f.trash});
    assert.deepEqual(f.recycled,[]);assert.ok(fs.existsSync(f.item.path));assert.ok(fs.existsSync(f.translation));
    assert.equal(f.library.data.documents.length,0);
  }
});

test('legacy external documents are never recycled',async t=>{
  const f=fixture(t);const external=f.library.upsert({path:f.source,name:'original.pdf',pages:1,size:8});
  const result=await removeLibraryDocuments(f.library,{ids:[external.id],deletePdf:true},{trash:f.trash});
  assert.deepEqual(result.removed,[external.id]);assert.deepEqual(f.recycled,[]);assert.ok(fs.existsSync(f.source));
});

test('missing PDFs and repeated removal are harmless',async t=>{
  const f=fixture(t);fs.unlinkSync(f.item.path);
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash});
  assert.deepEqual(result.errors,[]);assert.deepEqual(f.recycled,[f.translation]);
  assert.deepEqual((await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash})).removed,[]);
});

test('failed recycling retains the record and original PDF; batch successes still finish',async t=>{
  const f=fixture(t),otherSource=path.join(f.root,'second.pdf');fs.writeFileSync(otherSource,'second');
  const second=f.library.importCopy({path:otherSource,pages:1,size:6});
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id,second.id],deletePdf:true},{trash:async file=>{
    if(file===f.translation)throw new Error('文件被占用');await f.trash(file);
  }});
  assert.equal(result.errors.length,1);assert.match(result.errors[0].error,/文件被占用/);
  assert.deepEqual(result.removed,[second.id]);assert.ok(fs.existsSync(f.item.path));assert.equal(f.library.get(f.item.id),f.item);
});

test('partial recycle failure reports progress and can be retried',async t=>{
  const f=fixture(t);
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:async file=>{
    if(file===f.item.path)throw new Error('busy');await f.trash(file);
  }});
  assert.match(result.errors[0].error,/部分 PDF 已移至回收站/);assert.equal(result.documents.length,1);
  assert.deepEqual((await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash})).errors,[]);
});

test('out-of-library and redirected directories are rejected before any files are recycled',async t=>{
  const f=fixture(t);f.item.translationPath=f.source;
  let result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash});
  assert.equal(result.errors.length,1);assert.deepEqual(f.recycled,[]);assert.ok(fs.existsSync(f.item.path));
  f.item.translationPath=f.translation;
  const folder=path.dirname(f.item.path),moved=folder+'-moved';fs.renameSync(folder,moved);fs.symlinkSync(moved,folder,'junction');
  result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash});
  assert.equal(result.errors.length,1);assert.deepEqual(f.recycled,[]);
});

test('drains writes before deletion and rechecks newly saved translation paths',async t=>{
  const f=fixture(t),newPath=f.translation.replace('.pdf',' (2).pdf');
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash,beforeTrash:async item=>{
    await new Promise(resolve=>setTimeout(resolve,5));fs.writeFileSync(newPath,'latest translation');
    f.library.translation(item.path,1,newPath);
  }});
  assert.deepEqual(result.errors,[]);assert.deepEqual(f.recycled,[newPath,f.item.path]);assert.ok(fs.existsSync(f.translation));
});

test('unsaved notes prevent reader teardown and file deletion',async t=>{
  const f=fixture(t);
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:true},{trash:f.trash,beforeTrash:async()=>{throw new Error('笔记冲突');}});
  assert.match(result.errors[0].error,/笔记冲突/);assert.deepEqual(f.recycled,[]);assert.equal(result.documents.length,1);
});

test('failed index write restores the in-memory record',async t=>{
  const f=fixture(t);f.library.save=()=>{throw new Error('disk full');};
  const result=await removeLibraryDocuments(f.library,{ids:[f.item.id],deletePdf:false});
  assert.match(result.errors[0].error,/disk full/);assert.equal(result.documents.length,1);assert.equal(new Library(f.library.file).data.documents.length,1);
});
