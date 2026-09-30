import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),exe=process.env.PDFSANDWICH_TEST_EXE;
const profile=await fs.mkdtemp(path.join(root,'local-data','annotation-ui-'));
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
const file=path.join(profile,'Paragraph selection.pdf');await fs.copyFile('tmp/pdfs/annotation-fixture/source.pdf',file);
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
try{
  const page=await app.firstWindow();page.setDefaultTimeout(30000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
  async function stateWhen(predicate){const end=Date.now()+30000;while(Date.now()<end){const state=await call('state');if(predicate(state))return state;await new Promise(r=>setTimeout(r,50));}throw new Error('Annotation state timed out');}
  let state=await call('state');await call('settings',{...state.settings,autoTranslate:false});await call('open',{path:file});state=await call('state');
  const draftFile=path.join(profile,'documents',state.doc.id,'draft.json');
  const draft=JSON.parse(await fs.readFile(draftFile));
  for(let i=0;i<6;i++)draft.translations[i]={path:path.join(root,'tmp/pdfs/annotation-fixture',String(i),'zh.pdf'),status:'ready',warnings:0,qualityVersion:7};
  await fs.writeFile(draftFile,JSON.stringify(draft));await call('open',{path:file});
  async function select(side,start,end){
    await page.waitForFunction(({side,end})=>document.querySelector(`[data-side="${side}"][data-page="${end}"] .textLayer`)?.textContent.length>50,{side,end});
    await page.evaluate(({side,start,end})=>{
      const a=document.querySelector(`[data-side="${side}"][data-page="${start}"] .textLayer`),b=document.querySelector(`[data-side="${side}"][data-page="${end}"] .textLayer`);
      const range=document.createRange();range.setStart(a,0);range.setEnd(b,b.childNodes.length);
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    },{side,start,end});
  }
  const markedSide=async(side,id)=>page.locator(`[data-side="${side}"] [data-mark-id="${id}"]`).count();
  await page.getByRole('button',{name:'高亮文字',exact:true}).click();
  await select('en',1,1);
  state=await stateWhen(s=>s.doc.annotations.length===1&&s.doc.annotations[0].zh?.rects.length>3);
  const forward=state.doc.annotations[0];assert.equal(await markedSide('zh',forward.id),1);
  assert.equal(new Set(forward.zh.rects.map(JSON.stringify)).size,forward.zh.rects.length);
  await page.screenshot({path:'test-results/paragraph-highlight.png'});
  await call('undo');
  await page.getByRole('button',{name:'下划线',exact:true}).click();await select('zh',1,1);
  state=await stateWhen(s=>s.doc.annotations.length===1&&s.doc.annotations[0].en?.rects.length>5);
  assert.equal(await markedSide('en',state.doc.annotations[0].id),1);await call('undo');
  // Pin page 1 as a real drag would, then scroll far enough to unmount pages 2–3.
  await page.evaluate(()=>document.querySelector('[data-side="en"][data-page="1"] .textLayer span').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1})));
  await page.getByRole('textbox',{name:'当前页码'}).fill('5');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await select('en',1,5);
  state=await stateWhen(s=>s.doc.annotations.length===5&&s.doc.annotations.every(mark=>mark.zh?.rects.length>3));
  assert.deepEqual(state.doc.annotations.map(mark=>mark.page),[0,1,2,3,4]);
  await call('undo');assert.equal((await call('state')).doc.annotations.length,0);
  await call('redo');await stateWhen(s=>s.doc.annotations.length===5&&s.doc.annotations.every(mark=>mark.zh?.rects.length>3));
  await call('undo');
  await page.getByRole('textbox',{name:'当前页码'}).fill('1');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-side="zh"][data-page="1"] .textLayer')?.textContent.length>50);
  await page.evaluate(()=>document.querySelector('[data-side="zh"][data-page="1"] .textLayer span').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,buttons:1})));
  await page.getByRole('textbox',{name:'当前页码'}).fill('5');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await select('zh',1,5);
  await stateWhen(s=>s.doc.annotations.length===5&&s.doc.annotations.every(mark=>mark.origin==='zh'&&mark.en?.rects.length>5));
  await call('save');await call('open',{path:file});
  state=await stateWhen(s=>s.doc.annotations.length===5&&s.doc.annotations.every(mark=>mark.en&&mark.zh));
  assert.equal(state.doc.dirty,false);assert.deepEqual(errors,[]);
  const report={packaged:Boolean(exe),wholeParagraphBothDirections:true,multipleRecords:true,deduplicated:true,crossPageCount:5,crossPageBothDirections:true,virtualizedMiddlePages:true,singleUndoRedo:true,saveReopen:true,errors};
  await fs.writeFile('test-results/annotation-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
