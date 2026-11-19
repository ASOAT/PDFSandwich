const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const {ZoteroClient,parseLink,noteDocumentId,fromNoteDocumentId}=require('../electron/zotero.cjs');
const {ReadingSessions}=require('../electron/reading-session.cjs');
const attachment={key:'ABCD1234',data:{itemType:'attachment',contentType:'application/pdf',linkMode:'linked_file',parentItem:'EFGH5678',filename:'Paper.pdf'}};
const parent={key:'EFGH5678',data:{title:'A paper',creators:[{firstName:'Jane',lastName:'Doe'}],date:'2026-11-19',collections:['COLL1234'],tags:[{tag:'AI'}]}};
const response=(data,status=200,headers={})=>({text:typeof data==='string'?data:JSON.stringify(data),status,headers});

test('Zotero links validate attachment identity and preserve the requested page',()=>{
  const ref={library:'groups/123',key:'ABCD1234',serverId:'instance-test_1'};
  assert.deepEqual(fromNoteDocumentId(noteDocumentId(ref)),ref);
  assert.deepEqual(parseLink('pdfsandwich://zotero/groups/123/ABCD1234?page=5&server=instance-test_1'),{...ref,page:4});
  assert.deepEqual(parseLink('pdfsandwich://zotero/users/0/ABCD1234'),{library:'users/0',key:'ABCD1234'});
  for(const link of ['https://zotero/users/0/ABCD1234','pdfsandwich://zotero/users/1/ABCD1234','pdfsandwich://zotero/users/0/../../foo','pdfsandwich://zotero/users/0/ABCD1234?page=0','pdfsandwich://zotero/users/0/ABCD1234?page=1.5'])assert.throws(()=>parseLink(link));
});

test('Zotero catalog joins parent metadata and paginates collections without reading notes',async()=>{
  const calls=[];
  const client=new ZoteroClient({request:async(route,{serverId})=>{
    calls.push(route);
    if(calls.length>1)assert.equal(serverId,'test-instance');
    const data=route.includes('itemType=attachment')?[attachment,{key:'HTML1234',data:{itemType:'attachment',contentType:'text/html'}}]:route.includes('/collections')?[{key:'COLL1234',data:{name:'AI',parentCollection:false}}]:[parent];
    return response(data,200,{'zotero-server-id':'test-instance'});
  }});
  const result=await client.snapshot({library:'users/0'});
  assert.equal(result.documents.length,1);
  assert.deepEqual(result.documents[0].tags,['AI']);
  assert.equal(result.documents[0].authors,'Jane Doe');
  assert.equal(result.documents[0].year,'2026');
  assert.deepEqual(result.documents[0].collections,['COLL1234']);
  assert.ok(calls.every(route=>!route.includes('note')));
});

test('Zotero resolves the original attachment including legacy file redirects and missing files',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfsandwich-zotero-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const file=path.join(dir,'paper with 空格.pdf');await fs.writeFile(file,'%PDF-fixture');
  let remote=false,legacy=false;
  const client=new ZoteroClient({request:async route=>{
    if(route.endsWith('/file/view/url'))return legacy?response('',404):response(remote?'https://example.com/file.pdf':pathToFileURL(file).href);
    if(route.endsWith('/file'))return response('',302,{location:pathToFileURL(file).href});
    return response(route.endsWith('/EFGH5678')?parent:attachment);
  }});
  assert.equal((await client.resolve({key:'ABCD1234'})).path,file);
  remote=true;await assert.rejects(client.resolve({key:'ABCD1234'}),/本地 PDF/);
  legacy=true;assert.equal((await client.resolve({key:'ABCD1234'})).path,file);
  await fs.unlink(file);await assert.rejects(client.resolve({key:'ABCD1234'}),/尚未下载/);
});

test('Zotero reports disabled access and switched instances',async()=>{
  for(const [status,message] of [[403,/高级/],[412,/切换文库/]]){
    const client=new ZoteroClient({request:async()=>response('',status)});
    await assert.rejects(client.snapshot({library:'users/0'}),message);
  }
});

test('reading-session cleanup only removes disposable sessions and recovers interrupted runs',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfsandwich-session-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const sessions=new ReadingSessions(dir),a=await sessions.create();
  await fs.writeFile(path.join(a,'zh.pdf'),'temporary');
  const keep=path.join(sessions.root,'keep');await fs.mkdir(keep);await fs.writeFile(path.join(keep,'note.md'),'user note');
  await assert.rejects(sessions.remove(dir),/无效/);
  await sessions.sweep();await assert.rejects(fs.stat(a));
  assert.equal(await fs.readFile(path.join(keep,'note.md'),'utf8'),'user note');
  await sessions.remove(a);
});

test('Zotero companion registers a menu, opens a selected PDF and tears down its menu',async()=>{
  let config,unregistered,launched;
  const window={MozXULElement:{insertFTLIfNeeded(){}},document:{querySelector:()=>null}};
  const Zotero={initializationPromise:Promise.resolve(),getMainWindows:()=>[window],Prefs:{get:()=>true},
    Libraries:{userLibraryID:1},MenuManager:{registerMenu:value=>{config=value;return 'menu';},unregisterMenu:id=>{unregistered=id;}},
    launchURL:url=>{launched=url;},logError:error=>{throw error;}};
  const context=vm.createContext({Zotero});
  vm.runInContext(await fs.readFile(path.join(__dirname,'../zotero-plugin/bootstrap.js'),'utf8'),context);
  await context.startup({id:'test-plugin'});
  let visible=false;const item={isPDFAttachment:()=>true,libraryID:1,key:'ABCD1234',getFilePathAsync:async()=>'/fixture.pdf'};
  const menuContext={items:[item],setVisible:value=>{visible=value;}};
  config.menus[0].onShowing(null,menuContext);assert.equal(visible,true);
  await context.openAttachment([item]);assert.equal(launched,'pdfsandwich://zotero/users/0/ABCD1234');
  context.shutdown();assert.equal(unregistered,'menu');
});

test('Zotero startup returns before host initialization and disable prevents delayed registration',async()=>{
  let initialize,registrations=0;
  const initialized=new Promise(resolve=>{initialize=resolve;});
  const context=vm.createContext({Zotero:{initializationPromise:initialized,MenuManager:{registerMenu:()=>{registrations++;}},getMainWindows:()=>[],logError:error=>{throw error;}}});
  vm.runInContext(await fs.readFile(path.join(__dirname,'../zotero-plugin/bootstrap.js'),'utf8'),context);
  assert.equal(context.startup({id:'test-plugin'}),undefined);
  context.shutdown();initialize();await initialized;
  assert.equal(registrations,0);
});
