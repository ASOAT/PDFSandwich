import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const executable=process.env.PDFSANDWICH_TEST_EXE;
const data=await fs.mkdtemp(path.resolve('local-data/precision-ui-'));
await fs.symlink(path.resolve('local-data/models'),path.join(data,'models'),'junction');
const file=path.join(data,'reading.pdf');
await fs.copyFile('tmp/quality-benchmark/contents.pdf',file);
const app=await electron.launch({...(executable?{executablePath:path.resolve(executable)}:{args:['.']}),cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
let page;
try{
  page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const state=()=>page.evaluate(()=>window.pdfsandwich.call('state'));
  async function until(check,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const s=await state();if(s.doc?.translations[0]?.status==='error')throw new Error(s.doc.translations[0].error);if(check(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('Timed out');}
  const initial=await state();
  await page.evaluate(settings=>window.pdfsandwich.call('settings',{...settings,provider:'local',localEngine:'hy',autoTranslate:false,glossary:'',useGlossary:true}),initial.settings);
  await page.evaluate(path=>window.pdfsandwich.call('open',{path}),file);
  await page.evaluate(()=>window.pdfsandwich.call('translate',{page:0}));
  const translated=await until(s=>s.doc.translations[0]?.status==='ready');
  await page.waitForFunction(()=>document.querySelector('[data-side="zh"] .textLayer')?.textContent.includes('非完整')&&!document.querySelector('.page-rendering'));
  async function select(side,needle,tool='下划线'){
    if(tool)await page.getByRole('button',{name:tool,exact:true}).click();
    await page.evaluate(({side,needle})=>{
      const layer=document.querySelector(`[data-side="${side}"] .textLayer`), walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);
      let node;while(node=walker.nextNode()){const start=node.textContent.indexOf(needle);if(start<0)continue;const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+needle.length);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);layer.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return;}
      throw new Error('Selectable phrase missing: '+needle);
    },{side,needle});
  }
  await select('en','Nonholonomic');
  let s=await until(s=>s.doc.annotations.length===1&&s.doc.annotations[0].accuracy==='phrase');
  const forward=s.doc.annotations[0];assert.ok(forward.zh.rects.length===1);assert.ok(forward.zh.rects[0][2]-forward.zh.rects[0][0]<40);
  await select('zh','角速度');
  s=await until(s=>s.doc.annotations.length===2&&s.doc.annotations[1].accuracy==='phrase');
  const reverse=s.doc.annotations[1];assert.ok(reverse.en.rects.length===1);assert.ok(reverse.en.rects[0][2]-reverse.en.rects[0][0]<110);
  const resolution=await page.evaluate(()=>({dpr:devicePixelRatio,pages:[...document.querySelectorAll('.pdf-surface canvas')].map(c=>({width:c.width,cssWidth:parseFloat(c.style.width),height:c.height,cssHeight:parseFloat(c.style.height)}))}));
  for(const c of resolution.pages){assert.ok(c.width/c.cssWidth>=1.99);assert.ok(c.width*c.height<=16010000);}
  await page.screenshot({path:`test-results/precision-fit${executable?'-packaged':''}.png`});
  await page.getByRole('button',{name:'放大 Ctrl++',exact:true}).click();
  await page.getByRole('button',{name:'放大 Ctrl++',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  await page.getByRole('button',{name:'批注 2',exact:false}).click();
  await page.locator('.annotation-card').first().click();
  await page.getByRole('button',{name:'校正对应位置',exact:true}).click();
  await select('zh','非完整',null);
  s=await until(s=>s.doc.annotations[0].accuracy==='manual');
  const corrected=structuredClone(s.doc.annotations[0].zh);
  await page.evaluate(()=>window.pdfsandwich.call('undo'));
  await until(s=>s.doc.annotations[0].accuracy==='phrase');
  await page.evaluate(()=>window.pdfsandwich.call('redo'));
  await until(s=>s.doc.annotations[0].accuracy==='manual');
  await page.evaluate(()=>window.pdfsandwich.call('save'));
  await page.evaluate(path=>window.pdfsandwich.call('open',{path}),file);
  s=await state();assert.equal(s.doc.annotations[0].accuracy,'manual');assert.deepEqual(s.doc.annotations[0].zh,corrected);assert.ok(s.doc.annotations[1].en);
  await page.waitForFunction(()=>!document.querySelector('.page-rendering')&&document.querySelector('[data-side="zh"] .textLayer')?.textContent.includes('非完整'));
  await page.screenshot({path:`test-results/precision-zoom${executable?'-packaged':''}.png`});
  await page.getByRole('button',{name:'放大 Ctrl++',exact:true}).click({clickCount:1});
  for(let i=0;i<11;i++)await page.getByRole('button',{name:'放大 Ctrl++',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  await page.evaluate(()=>{for(const node of document.querySelectorAll('[data-reader]')){node.scrollTop=680;node.scrollLeft=200;}});
  await page.screenshot({path:`test-results/precision-detail${executable?'-packaged':''}.png`});
  assert.deepEqual(errors,[]);
  const report={packaged:Boolean(executable),translationSeconds:translated.doc.translations[0].seconds,resolution,forward,reverse,manualCorrection:true,undoRedo:true,nativeSaveReopen:true,errors};
  await fs.writeFile(`test-results/precision-ui${executable?'-packaged':''}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({packaged:report.packaged,translationSeconds:report.translationSeconds,resolution,manualCorrection:true,undoRedo:true,nativeSaveReopen:true,errors}));
}finally{
  if(page)await page.evaluate(()=>window.pdfsandwich.call('stop')).catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
