// Exercise real Electron pointer events; never open or mutate the user's library.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root=process.cwd(),exe=process.env.PDFSANDWICH_TEST_EXE;
const data=await fs.mkdtemp(path.resolve('local-data/signals-ui-'));
const file=path.join(data,'Signal test.pdf');
await fs.copyFile('tmp/pdfs/release-sample.pdf',file);
const digest=async()=>createHash('sha256').update(await fs.readFile(file)).digest('hex');
const before=await digest();
const launchFlags=['--disable-features=CalculateNativeWinOcclusion','--disable-renderer-backgrounding'];
const launch=()=>electron.launch({...(exe?{executablePath:path.resolve(exe),args:launchFlags}:{args:['.',...launchFlags]}),cwd:root,
  env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
let app=await launch();
const checks=[],errors=[];
let page;
async function shot(name){await page.waitForTimeout(180);await page.screenshot({path:`test-results/${name}.png`});}
try {
  page=await app.firstWindow();page.setDefaultTimeout(15000);
  page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1500,960);win.webContents.setBackgroundThrottling(false);win.setPosition(-4000,0);});
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const call=(op,args)=>page.evaluate(({op,args})=>window.pdfsandwich.call(op,args),{op,args});
  const state=await call('state');await call('settings',{...state.settings,autoTranslate:false});
  await call('open',{path:file});
  await page.waitForFunction(()=>document.querySelector('[data-side="en"] .textLayer')&&!document.querySelector('[data-side="en"] .page-rendering'));
  const wheel=page.getByRole('status',{name:'信号轮盘',exact:true});
  const surface=page.locator('.pdf-surface[data-side="en"]').first();
  const box=await surface.boundingBox(),origin={x:box.x+box.width*.5,y:box.y+300};
  async function begin(x=origin.x,y=origin.y){await page.mouse.move(x,y);await page.keyboard.down('Alt');await wheel.waitFor();}
  async function release(){await page.keyboard.up('Alt');}
  async function empty(){assert.equal(await page.locator('.signal-wheel,.reader-ping').count(),0);}
  async function esc(){await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.reader-ping'));}
  const labels=['疑问','重点','赞同','灵感','绷不住','喜欢'];
  for(let i=0;i<labels.length;i++){
    await begin();await page.mouse.move(origin.x+Math.sin(i*Math.PI/3-Math.PI/2)*80,origin.y-Math.cos(i*Math.PI/3-Math.PI/2)*80,{steps:5});
    assert.equal(await page.locator('.signal-center').textContent(),labels[i]);
    if(i===0)await shot('signal-wheel');
    await release();await page.locator(`.reader-ping[data-signal="${labels[i]}"]`).waitFor();
    if(i===0){assert.equal(await page.locator('.signal-question-symbol').textContent(),'?');assert.equal(await page.locator('.reader-ping').evaluate(el=>parseFloat(el.style.left)),origin.x);await shot('signal-ping');}
    await esc();await page.waitForTimeout(200);
  }
  checks.push('all six directions, left question at origin, no mouse button required');
  await begin();await release();await empty();
  await begin();await page.mouse.move(origin.x,origin.y-80);await page.mouse.move(origin.x+2,origin.y+2);await release();await empty();
  await begin();await page.mouse.move(origin.x,origin.y-80);await page.keyboard.press('Escape');await release();await empty();
  await begin();await page.mouse.move(origin.x,origin.y-80);await page.keyboard.down('Control');await release();await page.keyboard.up('Control');await empty();
  checks.push('center, Esc and modifier conflict cancel');
  for(const tool of ['手绘记号','高亮文字','下划线','添加批注','框选公式转 LaTeX','框选截图到剪贴板']){
    await page.getByRole('button',{name:tool,exact:true}).click();
    await begin();await page.mouse.move(origin.x,origin.y-80);await release();
    await page.locator('.reader-ping').waitFor();await esc();await page.waitForTimeout(220);
    assert.equal((await call('state')).doc.annotations.length,0,tool);
    assert.equal(await page.getByRole('dialog').count(),0,tool);
  }
  checks.push('all annotation/capture tools unaffected');
  await page.getByRole('button',{name:'手绘记号',exact:true}).click();
  await page.mouse.move(origin.x,origin.y);await page.mouse.down();await page.mouse.move(origin.x+55,origin.y+25,{steps:5});await page.mouse.up();
  await page.waitForFunction(async()=>(await window.pdfsandwich.call('state')).doc.annotations.length===1);
  await call('undo');await page.waitForFunction(async()=>(await window.pdfsandwich.call('state')).doc.annotations.length===0);
  await page.getByRole('button',{name:'选择文字',exact:true}).click();
  checks.push('normal drawing and undo preserved');
  const toggle=page.getByRole('button',{name:'互动信号',exact:true});
  await toggle.click();assert.equal(await toggle.getAttribute('aria-pressed'),'false');
  await page.mouse.move(origin.x,origin.y);await page.keyboard.down('Alt');await page.mouse.move(origin.x,origin.y-80);await release();await empty();
  assert.equal(await page.evaluate(()=>localStorage.getItem('reader-signals')),'off');await toggle.click();
  checks.push('persisted disable option');
  await page.mouse.move(800,90);await page.keyboard.down('Alt');await page.mouse.move(830,90);await release();await empty();
  checks.push('outside PDF ignored');
  await begin();await page.mouse.move(origin.x,origin.y-80);await release();await page.locator('.reader-ping').waitFor();
  await page.locator('.reader-ping').waitFor({state:'detached',timeout:3500});
  checks.push('automatic expiry');
  await begin();await page.mouse.move(origin.x,origin.y-80);await release();await page.locator('.reader-ping').waitFor();
  await page.mouse.wheel(0,150);await page.waitForFunction(()=>!document.querySelector('.reader-ping'));
  checks.push('scroll clears page signals');
  await page.getByRole('button',{name:'切换深色主题',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  await begin();await page.mouse.move(origin.x+65,origin.y-40);await shot('signal-wheel-dark');await release();await esc();
  checks.push('dark theme');
  // A lost native window focus must never leave a held gesture behind.
  await begin();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await release();await empty();
  checks.push('window blur cancels');
  // Exercise editing and real raster decoding with an original transparent fixture.
  const customize=()=>page.getByRole('button',{name:'自定义表情轮盘',exact:true}).click();
  await customize();await page.getByRole('dialog',{name:'自定义表情轮盘'}).waitFor();
  await page.locator('.signal-slot-list button').nth(4).click();
  await page.getByLabel('表情名称',{exact:true}).fill('测试表情');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=200;const x=c.getContext('2d');x.fillStyle='#f2a654';x.fillRect(0,30,160,140);x.fillStyle='#689ade';x.beginPath();x.arc(290,100,70,0,Math.PI*2);x.fill();return c.toDataURL('image/png').split(',')[1];});
  await page.getByLabel('选择表情图片',{exact:true}).setInputFiles({name:'custom.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.getByRole('heading',{name:'裁剪表情',exact:true}).waitFor();
  await page.getByRole('button',{name:'完整图片',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.signal-crop-canvas')?.getContext('2d').getImageData(0,0,1,1).data[3]===0);
  await shot('signal-crop');
  await page.getByRole('button',{name:'使用这张表情',exact:true}).click();
  assert.ok((await page.locator('.signal-editor-preview img').getAttribute('src')).startsWith('data:image/png;base64,'));
  await page.locator('.signal-slot-list button').nth(1).click();
  await page.getByLabel('表情类型',{exact:true}).selectOption('emoji');
  await page.getByLabel('Emoji 内容',{exact:true}).fill('👀');
  await page.getByLabel('表情名称',{exact:true}).fill('看看');
  await shot('signal-editor');
  await page.getByRole('button',{name:'保存轮盘',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'detached'});
  const saved=await call('signalsGet');assert.equal(saved.slots[4].kind,'image');assert.equal(saved.slots[1].value,'👀');
  await begin();await page.mouse.move(origin.x+70,origin.y+45);await release();
  await page.locator('.reader-ping[data-signal="测试表情"] img').waitFor();await shot('signal-custom-ping');await esc();
  await customize();await page.getByLabel('表情名称',{exact:true}).fill('不应保存');await page.getByRole('button',{name:'取消',exact:true}).click();assert.deepEqual(await call('signalsGet'),saved);
  checks.push('transparent image upload, crop, Emoji, custom ping and cancel');
  await app.evaluate(({app})=>app.exit(0));app=await launch();page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1500,960);win.webContents.setBackgroundThrottling(false);win.setPosition(-4000,0);});
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  assert.deepEqual(await call('signalsGet'),saved);await call('open',{path:file});
  await page.waitForFunction(()=>document.querySelector('[data-side="en"] .textLayer')&&!document.querySelector('.page-rendering'));
  // begin/esc are rebound to the restarted page through the shared variable.
  await page.mouse.move(origin.x,origin.y);await page.keyboard.down('Alt');await page.locator('.signal-wheel').waitFor();await page.mouse.move(origin.x+70,origin.y+45);await release();
  await page.locator('.reader-ping[data-signal="测试表情"] img').waitFor();await esc();
  await customize();await page.getByRole('button',{name:'全部恢复默认',exact:true}).click();await page.getByRole('button',{name:'保存轮盘',exact:true}).click();await page.getByRole('dialog').waitFor({state:'detached'});
  assert.equal((await call('signalsGet')).slots[0].value,'question');assert.ok(!String(await fs.readFile(path.join(data,'reader-signals.json'))).includes('data:image'));
  checks.push('app restart preserves custom images; reset removes embedded image data');
  assert.equal(await digest(),before);assert.equal((await call('state')).doc.annotations.length,0);
  assert.deepEqual(errors,[]);
  const report={packaged:Boolean(exe),checks,sourceUnchanged:true,errors};
  await fs.writeFile('test-results/signals-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} catch(error) {
  console.error('Completed checks:',checks);
  if(page)await shot('signals-failure').catch(()=>{});
  throw error;
} finally {
  if(page)await page.keyboard.up('Alt').catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
