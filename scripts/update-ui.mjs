import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const version = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const profile = await fs.mkdtemp(path.join(root, 'local-data', 'update-ui-'));
await fs.writeFile(path.join(profile, 'updates.json'), JSON.stringify({ autoCheck: false }));
const app = await electron.launch({ executablePath: path.join(root, `release/${version}/win-unpacked/PDFSandwich.exe`), env: { ...process.env, PDFSANDWICH_DATA_DIR: profile }, timeout: 60000 });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: '翻译与应用设置' }).click();
  await page.getByRole('region', { name: '软件更新' }).evaluate(el=>el.scrollIntoView({block:'center'}));
  assert.ok((await page.getByRole('region', { name: '软件更新' }).innerText()).includes(`当前版本 ${version}`));
  // Use the actual updater singleton; only replace its external network/installer.
  await app.evaluate(({ app }) => {
    const updater = process.mainModule.require(app.getAppPath() + '/node_modules/electron-updater').autoUpdater;
    global.testUpdater = updater;
    updater.checkForUpdates = async () => { updater.emit('update-available', { version: '9.0.0' }); return {}; };
    updater.downloadUpdate = async () => { updater.emit('download-progress', { percent: 40, transferred: 4e6, total: 1e7, bytesPerSecond: 2e6 }); return []; };
    updater.quitAndInstall = () => { global.installRequested = true; };
  });
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '下载更新', exact: true }).click();
  await page.getByRole('progressbar', { name: '更新下载进度' }).waitFor();
  await page.screenshot({ path: 'test-results/update-light.png' });
  await app.evaluate(() => global.testUpdater.emit('update-downloaded', { version: '9.0.0' }));
  await page.getByRole('button', { name: '重启并安装', exact: true }).waitFor();
  await page.getByRole('checkbox', { name: '自动检查新版本' }).click();
  await page.waitForFunction(()=>document.querySelector('.update-option input')?.checked);
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'updates.json'))).autoCheck, true);
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('button', { name: '切换深色主题' }).click();
  await page.getByRole('button', { name: '重启更新', exact: true }).click();
  await page.getByRole('region', { name: '软件更新' }).evaluate(el=>el.scrollIntoView({block:'center'}));
  await page.screenshot({ path: 'test-results/update-dark.png' });
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  const sample = path.join(profile, 'update-sample.pdf');
  await fs.copyFile(path.join(root, 'tmp/pdfs/reading-sample.pdf'), sample);
  const settings = await page.evaluate(() => window.pdfsandwich.call('state'));
  await page.evaluate(settings => window.pdfsandwich.call('settings', { ...settings, autoTranslate: false }), settings.settings);
  await page.evaluate(file => window.pdfsandwich.call('open', { path: file }), sample);
  await page.evaluate(() => window.pdfsandwich.call('annotate', { item: { id: 'update-test-note', page: 0, kind: 'note', origin: 'en', en: { rects: [[.2, .2, .25, .25]] }, color: '#edba39', width: 2, content: '升级时保留批注' } }));
  await page.getByRole('textbox',{name:'当前页码'}).fill('2');
  await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.getByRole('button',{name:'放大 Ctrl++',exact:true}).click();
  async function until(check){const end=Date.now()+20000;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Update action did not complete');}
  await app.evaluate(({ dialog }) => { global.promptCount=0;dialog.showMessageBox = async () => ({ response: global.promptCount++===0?2:0 }); });
  const note=await page.evaluate(()=>window.pdfsandwich.call('notesCreate',{title:'Update safety'}));
  const next=app.waitForEvent('window');await page.evaluate(id=>window.pdfsandwich.call('notesPopout',{id}),note.id);const noteWindow=await next;
  const editor=noteWindow.getByRole('textbox',{name:'实时 Markdown 编辑器'});await editor.waitFor();await editor.click();await editor.press('Control+End');await editor.press('Enter');await editor.pressSequentially('Saved before updating.');
  await page.getByRole('button',{name:'重启更新',exact:true}).click();
  await page.getByRole('button',{name:'重启并安装',exact:true}).click();
  await until(async()=>await app.evaluate(()=>global.promptCount===1)&&(await page.evaluate(()=>window.pdfsandwich.call('updateState'))).status==='downloaded');
  assert.equal(await app.evaluate(() => !!global.installRequested), false);
  await page.getByRole('button',{name:'重启并安装',exact:true}).click();
  await until(()=>app.evaluate(()=>!!global.installRequested));
  const saved = await page.evaluate(() => window.pdfsandwich.call('state'));
  assert.match((await page.evaluate(id=>window.pdfsandwich.call('notesGet',{id}),note.id)).content,/Saved before updating/);
  assert.equal(saved.doc.dirty, false); assert.ok(saved.doc.backup);
  const draft = JSON.parse(await fs.readFile(path.join(profile, 'documents', saved.doc.id, 'draft.json')));
  assert.ok(draft.annotations.some(mark => mark.content === '升级时保留批注'));
  assert.equal(JSON.parse(await fs.readFile(path.join(profile, 'resume-update.json'))).path, sample);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ packaged: true, progressUI: true, themes: 2, preferenceSaved: true, cancelInstallPreservesDocument: true, savedBeforeInstall: true,notesSavedBeforeInstall: true, resumePrepared: true, errors }));
} finally { await app.evaluate(({ app }) => app.exit(0)).catch(() => {}); }

const resumed = await electron.launch({ executablePath: path.join(root, `release/${version}/win-unpacked/PDFSandwich.exe`), env: { ...process.env, PDFSANDWICH_DATA_DIR: profile }, timeout: 60000 });
try {
  const page = await resumed.firstWindow();
  await page.locator('.header-document').getByText('update-sample.pdf',{exact:true}).waitFor({timeout:30000});
  const state=await page.evaluate(()=>window.pdfsandwich.call('state'));
  assert.ok(state.doc.annotations.some(mark=>mark.content==='升级时保留批注'));
  assert.equal(state.doc.currentPage,1);assert.equal(state.doc.viewZoom,1.1);
  assert.equal(state.settings.autoTranslate,false);
  assert.equal(await fs.stat(path.join(profile,'resume-update.json')).then(()=>true,()=>false),false);
  console.log(JSON.stringify({relaunchRestoresDocument:true,annotations:true,readingPosition:true,settings:true}));
}finally{await resumed.evaluate(({app})=>app.exit(0)).catch(()=>{});}
