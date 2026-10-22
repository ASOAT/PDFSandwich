const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../electron/library.cjs');
const {assertWritableDirectory}=require('../electron/storage.cjs');
const {removalFiles}=require('../electron/library-removal.cjs');
const {documentId}=require('../electron/library-migration.cjs');
const failure=code=>Object.assign(new Error(code),{code});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-storage-'));
  t.after(()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const preferred=path.join(root,'Program Files','PDFSandwich','Library'),fallback=path.join(root,'profile','Library');
  const file=path.join(root,'profile','library.json'),source=path.join(root,'paper.pdf');fs.writeFileSync(source,'PDF bytes');
  const options={fallbackRoot:fallback,defaultRoots:[preferred]};
  const metadata={path:source,pages:1,size:9,title:'Paper'};
  return {root,preferred,fallback,file,source,metadata,options};
}
test('a denied default uses persistent user storage and imports only once',t=>{
  const f=fixture(t),blocked=root=>{if(root===f.preferred)throw failure('EPERM');return assertWritableDirectory(root);};
  const library=new Library(f.file,f.preferred,{...f.options,probeStorage:blocked});
  const item=library.importCopy(f.metadata);
  assert.equal(path.dirname(path.dirname(item.path)),f.fallback);assert.equal(fs.readFileSync(item.path,'utf8'),'PDF bytes');
  assert.equal(fs.readFileSync(f.source,'utf8'),'PDF bytes');assert.equal(library.importCopy(f.metadata).id,item.id);
  const reopened=new Library(f.file,f.preferred,{...f.options,probeStorage:blocked});
  assert.equal(reopened.ensureStorage(),f.fallback);assert.equal(reopened.snapshot().documents.length,1);
  assert.match(reopened.snapshot().storageNotice,/写入权限/);
});
test('fallback retains old PDF, translation, IDs, drafts and registered removal boundaries',t=>{
  const f=fixture(t),library=new Library(f.file,f.preferred,f.options);
  const old=library.importCopy(f.metadata),oldPath=old.path,translation=oldPath.replace('.pdf','.zh.pdf');
  fs.writeFileSync(translation,'translated');library.translation(oldPath,1,translation);
  const draft=path.join(f.root,'profile','documents',documentId(oldPath),'draft.json');
  fs.mkdirSync(path.dirname(draft),{recursive:true});fs.writeFileSync(draft,'precious annotations');
  library.probeStorage=root=>{if(root===f.preferred)throw failure('EACCES');return assertWritableDirectory(root);};
  const source2=path.join(f.root,'another.pdf');fs.writeFileSync(source2,'second');
  const fresh=library.importCopy({...f.metadata,path:source2});
  assert.equal(path.dirname(path.dirname(fresh.path)),f.fallback);
  assert.equal(library.get(old.id).path,oldPath);assert.equal(fs.readFileSync(draft,'utf8'),'precious annotations');
  assert.equal(fs.readFileSync(oldPath,'utf8'),'PDF bytes');assert.deepEqual(removalFiles(library,old),[translation,oldPath]);
  old.translationPath=path.join(f.fallback,old.id,'bad.zh.pdf');
  assert.throws(()=>removalFiles(library,old),/未删除文件/);
});
test('explicit storage stays selected even when it matches a default path',t=>{
  const f=fixture(t),library=new Library(f.file,f.preferred,f.options);
  library.setStorageRoot(f.preferred);
  library.probeStorage=()=>{throw failure('EPERM');};
  assert.throws(()=>library.importCopy(f.metadata),/存储位置/);assert.equal(library.data.storageRoot,f.preferred);
  assert.equal(fs.existsSync(f.fallback),false);
});
test('full or unavailable default storage does not silently redirect imports',t=>{
  for(const code of ['ENOSPC','ENOENT','EIO']){
    const f=fixture(t),library=new Library(f.file,f.preferred,{...f.options,probeStorage:()=>{throw failure(code);}});
    assert.throws(()=>library.importCopy(f.metadata),{code});assert.equal(library.data.storageRoot,f.preferred);
    assert.equal(fs.existsSync(f.fallback),false);
  }
});
test('fallback is rolled back if its index cannot be saved',t=>{
  const f=fixture(t),library=new Library(f.file,f.preferred,{...f.options,probeStorage:root=>{if(root===f.preferred)throw failure('EPERM');return assertWritableDirectory(root);}});
  library.save=()=>{throw failure('ENOSPC');};
  assert.throws(()=>library.importCopy(f.metadata),{code:'ENOSPC'});
  assert.equal(library.data.storageRoot,f.preferred);assert.equal(library.data.managedRoots,undefined);assert.equal(library.data.documents.length,0);
});
test('destination mkdir permission race recovers but source-read failures do not',t=>{
  const f=fixture(t),library=new Library(f.file,f.preferred,{...f.options,probeStorage:()=>{}});
  const mkdir=fs.mkdirSync;
  t.mock.method(fs,'mkdirSync',function(folder,...args){if(path.dirname(String(folder))===f.preferred)throw failure('EPERM');return mkdir.call(fs,folder,...args);});
  const item=library.importCopy(f.metadata);assert.equal(path.dirname(path.dirname(item.path)),f.fallback);
  t.mock.restoreAll();
  const other=fixture(t),second=new Library(other.file,other.preferred,other.options);
  t.mock.method(fs,'copyFileSync',function(source){if(source===other.source)throw failure('EACCES');throw new Error('Unexpected copy');});
  assert.throws(()=>second.importCopy(other.metadata),{code:'EACCES'});assert.equal(second.data.storageRoot,other.preferred);assert.equal(fs.existsSync(other.fallback),false);
});
test('storage selection validates before persisting and leaves existing PDFs in place',t=>{
  const f=fixture(t),library=new Library(f.file,f.preferred,f.options),old=library.importCopy(f.metadata),oldPath=old.path;
  const bad=path.join(f.root,'denied');library.probeStorage=root=>{if(root===bad)throw failure('EPERM');return assertWritableDirectory(root);};
  assert.throws(()=>library.setStorageRoot(bad),/写入权限/);assert.equal(new Library(f.file).data.storageRoot,f.preferred);
  library.setStorageRoot(f.fallback);assert.equal(library.get(old.id).path,oldPath);assert.deepEqual(removalFiles(library,old),[oldPath]);
  assert.equal(new Library(f.file).data.storageRootMode,'custom');
});
