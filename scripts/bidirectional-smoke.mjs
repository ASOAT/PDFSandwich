import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
const app=await electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:path.resolve('local-data')},timeout:60000});
try{
  const page=await app.firstWindow();page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const getState=()=>page.evaluate(()=>window.pdfsandwich.call('state'));
  async function until(check){const deadline=Date.now()+30000;while(Date.now()<deadline){const s=await getState();if(check(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('Annotation state timed out');}
  const initial=await getState();await page.evaluate(s=>window.pdfsandwich.call('settings',{...s,provider:'local',autoTranslate:false}),initial.settings);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/pdfs/reading-sample.pdf'));
  await page.getByRole('textbox',{name:'当前页码'}).fill('1');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  let state=await getState();
  if(state.doc.translations[0]?.status!=='ready'){
    await page.evaluate(()=>window.pdfsandwich.call('translate',{page:0}));
    const deadline=Date.now()+180000;
    while(Date.now()<deadline){state=await getState();if(state.doc.translations[0]?.status==='error')throw new Error(state.doc.translations[0].error);if(state.doc.translations[0]?.status==='ready')break;await new Promise(r=>setTimeout(r,500));}
  }
  await page.evaluate(()=>window.pdfsandwich.call('stop'));
  await page.waitForFunction(()=>document.querySelector('[data-page="1"][data-side="zh"] .textLayer')?.textContent.length>30);
  const created=[];
  async function select(side,tool){
    const before=(await getState()).doc.annotations.length;
    await page.getByRole('button',{name:tool,exact:true}).click();
    await page.evaluate(side=>{const spans=[...document.querySelectorAll(`[data-page="1"][data-side="${side}"] .textLayer span`)];const el=spans.find(e=>e.textContent.includes(side==='zh'?'两种语言':'Reading in two'));if(!el)throw new Error('Expected real translated text');const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));},side);
    const s=await until(s=>s.doc.annotations.length===before+1&&s.doc.annotations.at(-1).en&&s.doc.annotations.at(-1).zh);
    created.push(s.doc.annotations.at(-1));
  }
  await select('en','高亮文字');await select('zh','下划线');
  const before=(await getState()).doc.annotations.length;
  await page.getByRole('button',{name:'手绘记号',exact:true}).click();
  const surface=await page.locator('[data-page="1"][data-side="zh"]').boundingBox();
  await page.mouse.move(surface.x+90,surface.y+360);await page.mouse.down();await page.mouse.move(surface.x+130,surface.y+340,{steps:6});await page.mouse.move(surface.x+170,surface.y+360,{steps:6});await page.mouse.up();
  state=await until(s=>s.doc.annotations.length===before+1&&s.doc.annotations.at(-1).en);created.push(state.doc.annotations.at(-1));
  await page.getByRole('button',{name:'添加批注',exact:true}).click();await page.mouse.click(surface.x+55,surface.y+330);
  await page.getByRole('textbox',{name:'批注内容'}).fill('中文侧的批注，原样同步到英文 PDF。');
  await page.getByRole('button',{name:'关闭批注编辑',exact:true}).click();
  state=await until(s=>s.doc.annotations.at(-1).content==='中文侧的批注，原样同步到英文 PDF。'&&s.doc.annotations.at(-1).en);created.push(state.doc.annotations.at(-1));
  const note=created.at(-1);
  await page.evaluate(id=>window.pdfsandwich.call('editAnnotation',{id,remove:true}),note.id);
  await until(s=>!s.doc.annotations.some(m=>m.id===note.id));
  await page.evaluate(()=>window.pdfsandwich.call('undo'));
  await until(s=>s.doc.annotations.some(m=>m.id===note.id));
  await page.getByRole('button',{name:'选择文字',exact:true}).click();
  await page.evaluate(()=>window.pdfsandwich.call('save'));
  await until(s=>!s.doc.dirty);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/pdfs/reading-sample.pdf'));
  state=await getState();
  for(const mark of created){const found=state.doc.annotations.find(m=>m.id===mark.id);if(!found?.en||!found.zh)throw new Error('Bilingual annotation lost after native save');}
  if(state.doc.translations[0]?.status!=='ready')throw new Error('Annotation-only save discarded translation cache');
  await page.screenshot({path:'test-results/bidirectional.png'});
  const report={created:created.map(m=>({kind:m.kind,origin:m.origin,accuracy:m.accuracy})),reopened:true,nativeSave:true,cacheRetained:true};
  await fs.writeFile('test-results/bidirectional.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
