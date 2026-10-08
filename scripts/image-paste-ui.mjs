import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),profile=await fs.mkdtemp(path.join(root,'local-data/image-paste-')),mode=process.env.PDFSANDWICH_NOTES_MODE||'standalone';
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false}));await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
if(mode==='obsidian'){
  const vault=path.join(profile,'Vault');await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});
  await fs.writeFile(path.join(vault,'.obsidian','app.json'),JSON.stringify({attachmentFolderPath:'99System/Attachments'}));
  await fs.writeFile(path.join(vault,'.obsidian','community-plugins.json'),'["obsidian-paste-image-rename"]');
  await fs.writeFile(path.join(profile,'notes-settings.json'),JSON.stringify({mode,vault,notesFolder:'03Literature'}));
}
const file=path.join(profile,'paper.pdf');execFileSync(path.resolve('.venv/Scripts/python.exe'),['-c',"import pymupdf as f,sys;d=f.open();p=d.new_page();p.insert_text((60,100),'Clipboard image test',fontsize=20);d.save(sys.argv[1])",file]);
const exe=process.env.PDFSANDWICH_TEST_EXE,app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile}}),page=await app.firstWindow();page.setDefaultTimeout(30000);
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));await call('open',{path:file});await page.locator('[data-side="en"] canvas').waitFor();await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  await page.getByRole('button',{name:'框选截图到剪贴板',exact:true}).click();
  const box=await page.locator('.pdf-surface[data-side="en"]').first().boundingBox(),s=(await call('state')).doc.pages[0],scale=box.width/s.width;
  await page.mouse.move(box.x+50*scale,box.y+70*scale);await page.mouse.down();await page.mouse.move(box.x+300*scale,box.y+110*scale,{steps:8});await page.mouse.up();
  await page.getByText('截图已复制，可粘贴到笔记或 Obsidian',{exact:true}).waitFor();
  assert.equal(await page.getByRole('dialog').count(),0);assert.equal((await call('notesList')).length,0);
  assert.equal(await app.evaluate(({clipboard})=>clipboard.has('image/png')),true);
  await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();const editor=page.getByRole('textbox',{name:'实时 Markdown 编辑器'});await editor.click();await page.keyboard.type('Before\n');await page.keyboard.press('Control+V');
  await page.locator('.live-image img').waitFor();await page.getByTitle('立即保存').click();
  const notes=await call('notesList'),note=await call('notesGet',{id:notes[0].id});assert.match(note.content,/Before/);assert.match(note.content,/!\[\]\(<[^>]+\.png>\)/);
  const cfg=await call('researchSettings'),files=await fs.readdir(cfg.attachmentDirectory);assert.equal(files.length,1);if(mode==='obsidian')assert.equal(files[0],path.basename(note.relative,'.md')+'.png');
  await page.getByRole('button',{name:'源码',exact:true}).click();const source=page.getByRole('textbox',{name:'Markdown 编辑器'});await source.click();await page.keyboard.press('Control+End');await page.keyboard.press('Control+V');
  await page.waitForFunction(()=>((document.querySelector('.markdown-editor')?.value||'').match(/!\[\]/g)||[]).length===2);await page.getByTitle('立即保存').click();assert.equal((await fs.readdir(cfg.attachmentDirectory)).length,2);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mode,packaged:!!exe,screenshotToClipboard:true,noPrematureFiles:true,livePaste:true,sourcePaste:true,naming:true,errors}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
