const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Library}=require('../electron/library.cjs');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdf-library-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const source=path.join(root,'input.pdf');fs.writeFileSync(source,'original bytes');return {root,source,library:new Library(path.join(root,'profile','library.json'),path.join(root,'app','文献库')),metadata:{path:source,pages:3,size:14,title:'Reading example',author:'Example Author'}};}
test('imports copy once, preserve originals, persist metadata, and use unique directories',t=>{
  const {root,source,library,metadata}=fixture(t);
  const parent=library.collection({name:'Research'}),child=library.collection({name:'Control',parentId:parent.id});
  const item=library.importCopy(metadata,child.id);assert.notEqual(item.path,source);assert.equal(fs.readFileSync(item.path,'utf8'),'original bytes');
  fs.appendFileSync(item.path,' edited copy');
  assert.equal(library.importCopy(metadata,parent.id).id,item.id);assert.equal(fs.readFileSync(source,'utf8'),'original bytes');assert.ok(fs.readFileSync(item.path,'utf8').endsWith('edited copy'));
  library.editDocument(item.id,{tags:['MPC','mpc','To read'],year:'2026',notes:'A note'});
  const reopened=new Library(library.file);assert.equal(reopened.get(item.id).notes,'A note');assert.deepEqual(reopened.get(item.id).tags,['mpc','To read']);assert.equal(reopened.get(item.id).collections.length,2);
  const other=path.join(root,'other');fs.mkdirSync(other);fs.copyFileSync(source,path.join(other,'input.pdf'));
  const second=library.importCopy({...metadata,path:path.join(other,'input.pdf')});assert.notEqual(second.path,item.path);
  library.removeCollection(parent.id);assert.deepEqual(item.collections,[]);assert.equal(library.data.documents.length,2);
  library.removeDocuments([item.id]);assert.ok(fs.existsSync(item.path));assert.ok(fs.existsSync(library.file+'.bak'));
});
test('recent files migrate on first import and invalid edits are transactional',t=>{
  const {source,library,metadata}=fixture(t);library.migrate([{...metadata,openedAt:123}]);library.migrate([{...metadata,path:'unwanted.pdf'}]);
  const old=library.data.documents[0];assert.equal(library.data.documents.length,1);assert.equal(old.path,source);assert.equal(old.lastOpenedAt,123);
  const item=library.importCopy(metadata);assert.equal(item.id,old.id);assert.equal(item.managed,true);
  const title=item.title;assert.throws(()=>library.editDocument(item.id,{title:'lost title',collections:['missing']}));assert.equal(item.title,title);
  const a=library.collection({name:'A'}),b=library.collection({name:'B',parentId:a.id});assert.throws(()=>library.collection({id:a.id,name:'A',parentId:b.id}));assert.equal(a.parentId,null);
  assert.throws(()=>library.setStorageRoot(path.dirname(source)));assert.ok(fs.existsSync(item.path));
});
