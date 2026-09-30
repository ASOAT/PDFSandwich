// PDFSANDWICH_PRIORITY_PDF must point to a disposable >= 26-page test document.
import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const executable=process.env.PDFSANDWICH_TEST_EXE;
const source=process.env.PDFSANDWICH_PRIORITY_PDF;
if(!source)throw new Error('Set PDFSANDWICH_PRIORITY_PDF to a test document (at least 26 pages).');
const data=await fs.mkdtemp(path.resolve('local-data/priority-ui-'));
await fs.symlink(path.resolve('local-data/models'),path.join(data,'models'),'junction');
const file=path.join(data,'reading.pdf');await fs.copyFile(source,file);
const app=await electron.launch({...(executable?{executablePath:path.resolve(executable)}:{args:['.']}),cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
let page;
try{
  page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  await page.evaluate(()=>{window.priorityEvents=[];window.pdfsandwich.onState(s=>window.priorityEvents.push({time:Date.now(),current:s.doc?.currentPage,active:Object.entries(s.doc?.translations||{}).filter(([,p])=>p.status==='translating').map(([i])=>Number(i)),ready:Object.entries(s.doc?.translations||{}).filter(([,p])=>p.status==='ready').map(([i])=>Number(i))}));});
  const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
  const state=()=>call('state');
  async function until(check,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const s=await state();const failure=Object.values(s.doc?.translations||{}).find(p=>p.status==='error');if(failure)throw new Error(failure.error);if(check(s))return s;await new Promise(r=>setTimeout(r,50));}throw new Error('Priority state did not settle');}
  async function jump(n){const input=page.getByRole('textbox',{name:'当前页码'});await input.fill(String(n));await input.press('Enter');}
  const initial=await state();await call('settings',{...initial.settings,provider:'local',localEngine:'hy',autoTranslate:false,glossary:`PDFSandwichTest${Date.now()} = 测试`});
  await call('open',{path:file});assert.ok((await state()).doc.pages.length>=26);
  await call('translate',{page:0,force:true});await until(s=>s.doc.translations[0]?.status==='ready'&&!s.translating);
  await call('settings',{...(await state()).settings,autoTranslate:true});
  await call('translate',{all:true});
  await until(s=>s.doc.translations[1]?.status==='translating'&&s.doc.translations[1].stage.includes('正文'));
  await new Promise(r=>setTimeout(r,450));
  const firstJump=Date.now();await jump(10);
  await until(s=>s.doc.translations[9]?.status==='translating');const firstSwitchMs=Date.now()-firstJump;
  await until(s=>s.doc.translations[9]?.status==='translating'&&s.doc.translations[9].stage.includes('正文'));
  await new Promise(r=>setTimeout(r,450));
  const rapidJump=Date.now();await jump(16);await jump(24);
  await until(s=>s.doc.translations[23]?.status==='translating');const latestSwitchMs=Date.now()-rapidJump;
  const final=await until(s=>s.doc.translations[23]?.status==='ready');
  assert.equal(final.doc.currentPage,23);assert.equal(final.doc.translations[1]?.status,'queued');
  assert.equal(final.doc.translations[9]?.status,'queued');assert.ok(final.queued>0);
  assert.ok(firstSwitchMs<15000);assert.ok(latestSwitchMs<15000);
  await page.waitForFunction(()=>document.querySelector('[data-side="zh"][data-page="24"] .textLayer')?.textContent&&!document.querySelector('[data-side="zh"][data-page="24"] .page-rendering'));
  await page.screenshot({path:`test-results/priority${executable?'-packaged':''}.png`});
  const events=await page.evaluate(()=>window.priorityEvents);
  // Return to a page interrupted during generation, reusing its immutable input
  // and any completed segments without a Windows sharing violation.
  await jump(2);await until(s=>s.doc.translations[1]?.status==='ready');
  // A completed page is shown even while whole-book work continues in the background.
  const cachedStart=Date.now();await jump(1);await until(s=>s.doc.currentPage===0&&s.doc.translations[0]?.status==='ready');
  const cachedJumpMs=Date.now()-cachedStart;
  await call('stop');await jump(5);await new Promise(r=>setTimeout(r,400));
  const paused=await state();assert.equal(paused.queued,0);assert.equal(paused.translating,false);
  // Upgrade retries only old pages with rejected segments, preserving good work
  // and avoiding repeated retries of a failure already checked by this version.
  await call('settings',{...paused.settings,autoTranslate:false});
  if(paused.doc.dirty)await call('save');
  const draftPath=path.join(data,'documents',paused.doc.id,'draft.json');
  const draft=JSON.parse(await fs.readFile(draftPath,'utf8'));
  draft.translations[2]={...draft.translations[0],warnings:1,qualityVersion:5};
  draft.translations[3]={...draft.translations[0],warnings:1,qualityVersion:7};
  await fs.writeFile(draftPath,JSON.stringify(draft));await call('open',{path:file});
  const migrated=await state();
  assert.equal(migrated.doc.translations[0].status,'ready');
  assert.equal(migrated.doc.translations[2],undefined);
  assert.equal(migrated.doc.translations[3].status,'ready');
  assert.deepEqual(errors,[]);
  const report={packaged:Boolean(executable),freshTranslationCache:true,firstSwitchMs,latestSwitchMs,cachedJumpMs,page24Seconds:final.doc.translations[23].seconds,page24Warnings:final.doc.translations[23].warnings,backgroundPagesPreserved:true,interruptedPageResumed:true,pauseRespected:true,partialCacheMigration:true,errors,events};
  await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/priority${executable?'-packaged':''}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,events:undefined}));
}catch(error){
  if(page){const events=await page.evaluate(()=>window.priorityEvents).catch(()=>[]);await fs.writeFile(path.join(data,'failed-events.json'),JSON.stringify(events,null,2));console.error('Diagnostic directory:',data);}
  throw error;
}finally{
  if(page)await page.evaluate(()=>window.pdfsandwich.call('stop')).catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
