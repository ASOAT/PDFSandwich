import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=process.cwd(),profile=await fs.mkdtemp(path.join(root,'local-data','library-actions-'));
const sourceFolder=path.join(profile,'originals');
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['scripts/library-fixture.py',sourceFolder]);
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({provider:'local',autoTranslate:false,saveTranslation:false}));
const originalBytes=await Promise.all([1,2,3].map(i=>fs.readFile(path.join(sourceFolder,`example-${i}.pdf`))));
const exe=process.env.PDFSANDWICH_TEST_EXE;
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
const page=await app.firstWindow(),errors=[];
page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
const exists=file=>fs.access(file).then(()=>true,()=>false);
async function until(check){for(let i=0;i<200;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out waiting for state');}
async function library(){await page.getByRole('button',{name:'文献库',exact:true}).click();}
const row=title=>page.getByRole('row',{name:`文献 ${title}`,exact:true});
async function removal(title){await row(title).click({button:'right'});await page.getByRole('menuitem',{name:'移出文献库…',exact:true}).click();await page.getByRole('dialog',{name:'确认移除'}).waitFor();assert.equal(await page.getByRole('checkbox',{name:'同时删除 PDF',exact:true}).isChecked(),true);}
try {
  await page.getByRole('heading',{name:'全部文献'}).waitFor();
  await page.getByRole('button',{name:'列表视图',exact:true}).click();
  const imported=await call('libraryImport',{paths:[1,2,3].map(i=>path.join(sourceFolder,`example-${i}.pdf`))});
  assert.deepEqual(imported.errors,[]);await library();
  const [first,second,third]=imported.library.documents;
  await page.getByRole('button',{name:'新建分类',exact:true}).click();
  await page.getByRole('textbox',{name:'分类名称'}).fill('Research');await page.getByRole('button',{name:'保存分类'}).click();
  let state=await call('libraryState');const parent=state.collections.find(c=>c.name==='Research');
  await page.getByRole('button',{name:'在 Research 下新建子分类',exact:true}).click();
  assert.equal(await page.getByRole('combobox',{name:'上级分类'}).inputValue(),parent.id);
  await page.getByRole('textbox',{name:'分类名称'}).fill('Control');await page.getByRole('button',{name:'保存分类'}).click();
  state=await call('libraryState');const child=state.collections.find(c=>c.name==='Control');assert.equal(child.parentId,parent.id);
  await page.getByRole('button',{name:'在 Control 下新建子分类',exact:true}).click();
  await page.getByRole('textbox',{name:'分类名称'}).fill('MPC');await page.getByRole('button',{name:'保存分类'}).click();
  const leaf=(await call('libraryState')).collections.find(c=>c.name==='MPC');assert.equal(leaf.parentId,child.id);
  for(let i=0;i<35;i++)await call('libraryCollection',{name:`Topic ${String(i).padStart(2,'0')}`,parentId:null});
  await library();await row(first.title).click();await row(second.title).click({modifiers:['Control']});
  await row(first.title).click({button:'right'});
  assert.equal(await page.getByRole('menuitem',{name:'Research',exact:true}).count(),0);
  assert.ok(await page.getByRole('menuitem').count()<=10);
  await page.getByRole('menuitem',{name:'移至分类',exact:true}).click();
  assert.equal(await page.getByRole('menuitem',{name:'Control',exact:true}).count(),0);
  assert.ok(await page.getByRole('menu').evaluate(node=>node.scrollHeight>node.clientHeight));
  await page.getByRole('menuitem',{name:'Research',exact:true}).focus();await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('menuitem',{name:'MPC',exact:true}).count(),0);
  await page.getByRole('menuitem',{name:'Control',exact:true}).click();
  await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('menuitem',{name:'MPC',exact:true}).count(),0);
  await page.getByRole('menuitem',{name:'Control',exact:true}).click();
  await page.screenshot({path:'test-results/library-move-menu.png'});
  await page.getByRole('menuitem',{name:'MPC',exact:true}).click();
  await until(async()=>(await call('libraryState')).documents.filter(item=>[first.id,second.id].includes(item.id)).every(item=>item.collections.includes(leaf.id)));
  // Parent collections remain valid move targets, even when they have children.
  await row(third.title).click({button:'right'});await page.getByRole('menuitem',{name:'移至分类',exact:true}).click();
  await page.getByRole('menuitem',{name:'Research',exact:true}).click();await page.getByRole('menuitem',{name:'移至此分类',exact:true}).click();
  await until(async()=>(await call('libraryState')).documents.find(item=>item.id===third.id).collections.includes(parent.id));
  await removal(first.title);await page.screenshot({path:'test-results/library-remove-dialog.png'});
  await page.getByRole('checkbox',{name:'同时删除 PDF'}).uncheck();await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.ok(await exists(first.path));assert.equal((await call('libraryState')).documents.length,3);
  await removal(first.title);await page.getByRole('checkbox',{name:'同时删除 PDF'}).uncheck();
  await page.getByRole('button',{name:'确认移除',exact:true}).click();await row(first.title).waitFor({state:'detached'});assert.ok(await exists(first.path));
  // Keep test recycling local and record every path; one final check uses the OS recycler.
  await app.evaluate(({shell},profile)=>{
    const fs=process.getBuiltinModule('node:fs'),path=process.getBuiltinModule('node:path');globalThis.testOriginalTrash=shell.trashItem;
    globalThis.testTrashFiles=[];globalThis.testTrashFailure='';fs.mkdirSync(path.join(profile,'TestRecycleBin'));
    shell.trashItem=async file=>{if(file===globalThis.testTrashFailure)throw Error('Test file is busy');globalThis.testTrashFiles.push(file);fs.renameSync(file,path.join(profile,'TestRecycleBin',String(globalThis.testTrashFiles.length)+'.pdf'));};
  },profile);
  await row(second.title).dblclick();await page.getByRole('textbox',{name:'当前页码'}).waitFor();
  let reading=await call('state');const draftPath=path.join(profile,'documents',reading.doc.id,'draft.json');
  const draft=JSON.parse(await fs.readFile(draftPath,'utf8'));draft.translations={0:{path:path.join(sourceFolder,'translated-page.pdf'),status:'ready',qualityVersion:7}};
  await fs.writeFile(draftPath,JSON.stringify(draft));await call('libraryOpen',{id:second.id});
  const note=await call('notesForDocument',{documentId:second.id}),noteBefore=await call('notesGet',{id:note.id});
  await call('settings',{...(await call('state')).settings,saveTranslation:true});
  await until(async()=>(await call('state')).doc.autoSave?.status==='saved');reading=await call('state');const translated=reading.doc.autoSave.path;
  const unrelated=path.join(path.dirname(second.path),'personal-backup.pdf');await fs.writeFile(unrelated,'Do not delete');
  await call('annotate',{item:{id:'deletion-draft',kind:'note',page:1,color:'#edba39',content:'Unsaved annotation',origin:'en',en:{rects:[[55,180,70,195]]},accuracy:'manual'}});
  await library();await removal(second.title);await page.getByRole('button',{name:'确认移除',exact:true}).click();
  await row(second.title).waitFor({state:'detached'});assert.equal((await call('state')).doc,null);
  assert.equal(await exists(second.path),false);assert.equal(await exists(translated),false);
  assert.ok(await exists(unrelated));assert.deepEqual(await call('notesGet',{id:note.id}),noteBefore);
  assert.deepEqual(await app.evaluate(()=>globalThis.testTrashFiles),[translated,second.path]);
  await new Promise(resolve=>setTimeout(resolve,1700));assert.equal(await exists(translated),false);
  await app.evaluate((_,file)=>{globalThis.testTrashFailure=file;},third.path);
  await removal(third.title);await page.getByRole('button',{name:'确认移除',exact:true}).click();
  await page.getByRole('dialog',{name:'确认移除'}).waitFor({state:'detached'});
  await page.getByText(/未移除文献记录：Test file is busy/).waitFor();assert.ok(await exists(third.path));assert.equal((await call('libraryState')).documents.length,1);
  await app.evaluate(({shell})=>{shell.trashItem=globalThis.testOriginalTrash;});
  const realTrash=await call('libraryRemove',{ids:[third.id],deletePdf:true});assert.deepEqual(realTrash.errors,[]);assert.equal(await exists(third.path),false);
  for(let i=0;i<3;i++)assert.deepEqual(await fs.readFile(path.join(sourceFolder,`example-${i+1}.pdf`)),originalBytes[i]);
  assert.deepEqual(errors,[]);
  const report={packaged:!!exe,profile,defaultDelete:true,cancelAndKeepFiles:true,activeDocumentClosed:true,pendingSaveDrained:true,translationRecycled:true,notesAndOriginalsRetained:true,failureKeepsRecord:true,realWindowsRecycle:true,childCreation:true,nestedMoveMenu:true,batchMove:true,parentMove:true,boundedMenu:true,keyboardNavigation:true,errors};
  await fs.writeFile('test-results/library-actions-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
