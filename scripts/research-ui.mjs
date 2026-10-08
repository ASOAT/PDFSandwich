import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd();await fs.mkdir('local-data',{recursive:true});await fs.mkdir('test-results',{recursive:true});
const profile=await fs.mkdtemp(path.join(root,'local-data/research-ui-')),originals=path.join(profile,'originals');
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['scripts/library-fixture.py',originals]);
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({provider:'local',autoTranslate:false}));
const exe=process.env.PDFSANDWICH_TEST_EXE;
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
  await page.getByRole('heading',{name:'全部文献'}).waitFor();
  const imported=await call('libraryImport',{paths:[1,2,3].map(i=>path.join(originals,`example-${i}.pdf`))});
  const id=imported.imported[0];assert.equal(path.basename(imported.library.storageRoot),'Library');
  await page.getByRole('button',{name:'文献库',exact:true}).click();
  await page.locator('.library-cover img').first().waitFor();await page.screenshot({path:'test-results/research-library.png'});
  await page.locator('.library-grid-card').first().click({button:'right'});await page.getByRole('menuitem',{name:'复制 BibTeX',exact:true}).click();
  await call('libraryOpen',{id});await page.locator('[data-side="en"] .textLayer span').first().waitFor();
  await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();const editor=page.getByRole('textbox',{name:'Markdown 编辑器'});await page.getByRole('button',{name:'源码',exact:true}).click();await editor.waitFor();
  const text=await editor.inputValue();await editor.fill(text+'\nMy handwritten idea.\n');await page.getByTitle('立即保存').click();
  const note=await call('notesForDocument',{documentId:id});assert.match(note.content,/My handwritten idea/);
  // An external editor modifies the same local file; the idle panel reloads it.
  const config=await call('researchSettings');const noteFile=path.join(config.root,note.relative);await fs.appendFile(noteFile,'\nWritten in another editor.\n');
  await page.waitForFunction(()=>document.querySelector('.markdown-editor')?.value.includes('Written in another editor.'));
  await page.getByRole('button',{name:'双栏原文译文',exact:true}).click();
  await page.evaluate(()=>{const node=[...document.querySelectorAll('[data-side="en"] .textLayer span')].find(e=>e.textContent.trim().length>10);const range=document.createRange();range.selectNodeContents(node);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);node.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:400,clientY:300}));});
  await page.getByRole('menuitem',{name:'加入文献笔记…',exact:true}).click();await page.getByRole('textbox',{name:'摘录个人想法'}).fill('Contextual observation');await page.getByRole('button',{name:'加入笔记',exact:true}).click();
  await page.getByRole('button',{name:'源码',exact:true}).click();await editor.waitFor();await page.waitForFunction(()=>document.querySelector('.markdown-editor')?.value.includes('Contextual observation'));
  const excerptNote=await call('notesForDocument',{documentId:id});assert.match(excerptNote.content,/pdfsandwich:\/\/document/);assert.match(excerptNote.content,/My handwritten idea/);
  await page.getByRole('button',{name:'只读',exact:true}).click();await page.locator('.markdown-body a').first().waitFor();await page.screenshot({path:'test-results/research-notes.png'});
  await page.locator('.markdown-body a').filter({hasText:'第 1 页'}).first().click();await page.locator('.reader-columns.layout-dual').waitFor();
  await page.getByRole('button',{name:'阅读与笔记设置',exact:true}).click();await page.getByRole('button',{name:/莫奈/}).click();await page.getByRole('button',{name:'关闭笔记设置'}).click();
  await page.getByRole('button',{name:'切换深色主题'}).click();await page.getByRole('button',{name:'文献库',exact:true}).click();await page.locator('.library-cover img').first().waitFor();await page.screenshot({path:'test-results/research-dark.png'});
  const nextWindow=app.waitForEvent('window');await call('notesPopout',{id:note.id});const popout=await nextWindow;
  if(popout){await popout.getByRole('textbox',{name:'实时 Markdown 编辑器'}).waitFor();}
  assert.deepEqual(errors,[]);console.log(JSON.stringify({profile,gridCovers:true,contextMenu:true,notesAutosave:true,externalEdits:true,excerpt:true,deepLink:true,palettes:true,errors}));
}catch(error){await page.screenshot({path:'test-results/research-failure.png'}).catch(()=>{});throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
