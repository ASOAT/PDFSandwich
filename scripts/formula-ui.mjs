import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),profile=await fs.mkdtemp(path.join(root,'local-data/formula-ui-'));
await fs.mkdir(path.join(profile,'models'));await fs.symlink(path.resolve('tmp/formula-model'),path.join(profile,'models/formula'),'junction');
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false}));await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
const mode=process.env.PDFSANDWICH_NOTES_MODE||'standalone';
if(mode==='obsidian'){const vault=path.join(profile,'Vault');await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});await fs.writeFile(path.join(vault,'.obsidian','app.json'),JSON.stringify({attachmentFolderPath:'99System/Attachments'}));await fs.writeFile(path.join(profile,'notes-settings.json'),JSON.stringify({mode,vault,notesFolder:'03Literature'}));}
const file=path.join(profile,'formula.pdf');
execFileSync(path.resolve('.venv/Scripts/python.exe'),['-c',"import pymupdf as f,sys; d=f.open(); p=d.new_page(); p.insert_image(f.Rect(80,120,420,210),filename='tmp/formula-model/upstream-test.png'); d.save(sys.argv[1])",file]);
const exe=process.env.PDFSANDWICH_TEST_EXE,app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile}}),page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));await call('open',{path:file});await page.locator('[data-side="en"] canvas').waitFor();await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  await page.getByRole('button',{name:'框选公式转 LaTeX',exact:true}).click();
  const box=await page.locator('.pdf-surface[data-side="en"]').first().boundingBox();const s=(await call('state')).doc.pages[0],scale=box.width/s.width;
  await page.mouse.move(box.x+70*scale,box.y+110*scale);await page.mouse.down();await page.mouse.move(box.x+430*scale,box.y+220*scale,{steps:10});await page.mouse.up();
  await page.getByRole('dialog',{name:'提取公式'}).waitFor();assert.equal(await page.getByRole('button',{name:'本地识别为 LaTeX',exact:true}).count(),0);
  await page.waitForFunction(()=>document.querySelector('.latex-editor')?.value.length>10,{},{timeout:120000});
  const latex=await page.getByRole('textbox',{name:'LaTeX 公式代码'}).inputValue();assert.match(latex,/frac/);assert.match(latex,/x/);assert.match(latex,/y/);
  await page.locator('.formula-preview .katex').waitFor();await page.getByRole('button',{name:'复制 Markdown',exact:true}).click();
  const copied=await app.evaluate(({clipboard})=>clipboard.readText());assert.equal(copied,'$$\n'+latex+'\n$$');
  await page.screenshot({path:'test-results/formula-extraction.png'});await page.getByRole('button',{name:'加入笔记',exact:true}).click();
  await page.locator('.live-image img').waitFor();await page.locator('.live-math-block .katex').waitFor();
  const notes=await call('notesList'),note=await call('notesGet',{id:notes[0].id});assert.ok(note.content.includes(latex));if(mode==='obsidian'){assert.match(note.content,/99System\/Attachments/);const cfg=await call('researchSettings');assert.equal((await fs.readdir(cfg.attachmentDirectory)).length,1);}else assert.match(note.content,/assets\//);assert.match(note.content,/pdfsandwich:\/\/document/);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({packaged:!!exe,mode,latex,capture:true,clipboard:true,attachment:true,liveRendering:true,errors}));
}catch(error){await page.screenshot({path:'test-results/formula-failure.png'});throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
