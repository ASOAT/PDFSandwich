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
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe),args:launchFlags}:{args:['.',...launchFlags]}),cwd:root,
  env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
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
