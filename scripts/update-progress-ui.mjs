// Isolated packaged-app test. Intercept installer launch; never install over the user's app.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const exe=process.env.PDFSANDWICH_TEST_EXE;
if(!exe)throw new Error('Set PDFSANDWICH_TEST_EXE to the packaged test app');
const data=await fs.mkdtemp(path.resolve('local-data/update-progress-ui-'));
const file=path.join(data,'Update test.pdf'),resume=path.join(data,'resume-update.json');
await fs.copyFile('tmp/pdfs/release-sample.pdf',file);
await fs.writeFile(path.join(data,'updates.json'),JSON.stringify({autoCheck:false}));
const launch=()=>electron.launch({executablePath:path.resolve(exe),args:['--disable-features=CalculateNativeWinOcclusion','--disable-renderer-backgrounding'],
  cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
let app=await launch(),page;const errors=[],checks=[];
async function init(){
  page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.setContentSize(1300,900);win.webContents.setBackgroundThrottling(false);win.setPosition(-4000,0);});
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
}
const call=(op,args)=>page.evaluate(({op,args})=>window.pdfsandwich.call(op,args),{op,args});
const progress=async p=>{
  const s=await call('updateState');
  await app.evaluate(({BrowserWindow},{s,p})=>BrowserWindow.getAllWindows()[0].webContents.send('pdfsandwich:update',{...s,progress:p}),{s,p});
};
try{
  await init();
  let state=await call('state');await call('settings',{...state.settings,autoTranslate:false});
  await call('open',{path:file});
  await page.waitForFunction(()=>document.querySelector('[data-side="en"] .textLayer')&&!document.querySelector('[data-side="en"] .page-rendering'));
  await progress({phase:'preparing',label:'正在保存 PDF 批注',completed:1,total:5});
  const bar=page.getByRole('progressbar',{name:'安装准备步骤进度',exact:true});
  await bar.waitFor();assert.equal(await bar.getAttribute('value'),'1');
  assert.equal(await page.locator('.update-stage li.done').count(),1);
  await progress({phase:'preparing',label:'正在关闭 PDF 后台服务',completed:4,total:5});
  await page.waitForFunction(()=>document.querySelector('.update-stage progress')?.value===4);
  await page.screenshot({path:'test-results/update-progress-light.png'});
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});
  await page.screenshot({path:'test-results/update-progress-dark.png'});
  await progress({phase:'handoff',label:'准备完成，正在打开安装进度窗口',completed:5,total:5});
  await page.getByText('接下来由安装器显示文件安装进度，完成后自动重新启动。',{exact:true}).waitFor();
  await progress({phase:'restarting',label:'正在恢复上次阅读的文档',completed:1,total:2});
  await page.getByRole('dialog',{name:'更新后重新启动',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar',{name:'启动步骤进度',exact:true}).getAttribute('value'),'1');
  await page.screenshot({path:'test-results/update-restart.png'});
  await progress(null);await page.locator('.update-stage').waitFor({state:'detached'});
  checks.push('actual step values, preparation/handoff/restart, light and dark presentation, overlay removal');

  // Exercise real main-process preparation; only the final executable launch is replaced.
  await page.evaluate(()=>{window.updateStages=[];window.pdfsandwich.onUpdate(s=>window.updateStages.push(s));});
  await app.evaluate(({app})=>{
    const {autoUpdater}=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json')('electron-updater');
    autoUpdater.quitAndInstall=(silent,restart)=>{global.testInstallArgs=[silent,restart];};
    autoUpdater.emit('update-downloaded',{version:app.getVersion()});
  });
  const final=await call('updateInstall');assert.equal(final.progress.phase,'handoff');
  assert.deepEqual(await app.evaluate(()=>global.testInstallArgs),[false,true]);
  const stages=await page.evaluate(()=>window.updateStages.filter(s=>s.progress?.phase==='preparing').map(s=>s.progress.completed));
  for(const n of [0,1,2,3,4,5])assert.ok(stages.includes(n),`Missing preparation stage ${n}`);
  const marker=JSON.parse(await fs.readFile(resume,'utf8'));assert.equal(marker.path,file);
  checks.push('real note/PDF/translation preparation, resume marker, visible-install request');
  await app.evaluate(({app})=>app.exit(0));app=await launch();await init();
  await page.waitForFunction(async()=>(await window.pdfsandwich.call('state')).doc?.name==='Update test.pdf');
  await page.waitForFunction(async()=>(await window.pdfsandwich.call('updateState')).progress===null);
  await page.waitForFunction(()=>document.querySelector('[data-side="en"] .textLayer')&&!document.querySelector('[data-side="en"] .page-rendering'));
  await assert.rejects(fs.stat(resume),{code:'ENOENT'});
  checks.push('real app restart restores PDF and dismisses progress; one-shot marker consumed');
  assert.deepEqual(errors,[]);
  const result={packaged:true,checks,preparationStages:stages,errors};
  await fs.writeFile('test-results/update-progress-ui.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
