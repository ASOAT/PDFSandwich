import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const executable=process.env.PDFSANDWICH_TEST_EXE;
const dataDir=path.resolve(`local-data/reading-test-${executable?'packaged':'source'}`);
const fixtureDir=path.resolve('tmp/reading-test');
await fs.mkdir(fixtureDir,{recursive:true});await fs.mkdir('test-results',{recursive:true});
const fileA=path.join(fixtureDir,'first.pdf'),fileB=path.join(fixtureDir,'second.pdf');
await fs.copyFile('tmp/pdfs/reading-sample.pdf',fileA);
await fs.copyFile('tmp/pdfs/reading-sample.pdf',fileB);
const errors=[];let app,page;
async function launch(){
  app=await electron.launch({...(executable?{executablePath:path.resolve(executable)}:{args:['.']}),cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:dataDir},timeout:60000});
  page=await app.firstWindow();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
}
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
async function waitState(check){const until=Date.now()+30000;while(Date.now()<until){const state=await call('state');if(check(state))return state;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Reading state did not settle');}
async function jump(n){const input=page.getByRole('textbox',{name:'当前页码'});await input.fill(String(n));await input.press('Enter');await waitState(s=>s.doc.currentPage===n-1);}
async function snapshot(){return page.evaluate(()=>({top:[...document.querySelectorAll('[data-reader]')].map(el=>el.scrollTop),zoom:document.querySelector('.zoom-value').textContent}));}
async function restored(expected){
  await page.waitForFunction(value=>document.querySelector('.zoom-value')?.textContent===value,expected.zoom);
  await page.waitForFunction(tops=>[...document.querySelectorAll('[data-reader]')].every((el,i)=>Math.abs(el.scrollTop-tops[i])<3),expected.top);
  return snapshot();
}
try{
  await launch();const initial=await call('state');await call('settings',{...initial.settings,provider:'local',autoTranslate:false});
  await call('open',{path:fileA});await jump(3);
  await page.keyboard.press('Control+0');
  for(let i=0;i<5;i++)await page.keyboard.press('Control+=');
  await page.waitForFunction(()=>document.querySelector('.zoom-value').textContent==='150%');
  const bounds=await page.locator('[data-reader="en"]').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.55,bounds.y+bounds.height*.4);await page.mouse.wheel(0,240);
  await waitState(s=>s.doc.viewZoom===1.5&&s.doc.currentPage===2&&s.doc.currentFraction>.15);
  const saved=await snapshot(),savedState=(await call('state')).doc;
  await call('open',{path:fileA});const sameFile=await restored(saved);
  const oldUrl=(await call('state')).doc.sourceUrl;
  await call('open',{path:fileB});await page.waitForFunction(()=>document.querySelector('.zoom-value').textContent==='适合页宽');
  await call('page',{documentUrl:oldUrl,page:5,fraction:.9,zoom:3});
  const other=(await call('state')).doc;assert.equal(other.currentPage,0);assert.equal(other.viewZoom,1);
  await call('open',{path:fileA});await restored(saved);
  await app.evaluate(({app})=>app.exit(0));await launch();
  await call('open',{path:fileA});const afterRestart=await restored(saved);
  const reopened=(await call('state')).doc;
  assert.equal(reopened.currentPage,savedState.currentPage);assert.ok(Math.abs(reopened.currentFraction-savedState.currentFraction)<.005);
  // Schedule a scroll save, then immediately jump; the old debounce must not win.
  await page.locator('[data-reader="en"]').evaluate(el=>{el.scrollTop+=120;el.dispatchEvent(new Event('scroll'));});
  await jump(5);await new Promise(resolve=>setTimeout(resolve,400));assert.equal((await call('state')).doc.currentPage,4);
  await call('translate',{all:true});const queued=await call('state');
  assert.equal(queued.doc.translations[4].status,'translating');assert.equal(queued.queued,5);
  await call('stop');await waitState(s=>!s.translating&&s.queued===0);
  await page.screenshot({path:`test-results/reading-state${executable?'-packaged':''}.png`});
  assert.deepEqual(errors,[]);
  const report={packaged:Boolean(executable),saved,sameFile,afterRestart,staleDocumentIgnored:true,pendingScrollJump:true,wholeBookCurrentPageFirst:true,errors};
  await fs.writeFile(`test-results/reading-state${executable?'-packaged':''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
