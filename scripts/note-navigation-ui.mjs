import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const profile=await fs.mkdtemp(path.resolve('local-data/note-navigation-'));await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false}));await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
const exe=process.env.PDFSANDWICH_TEST_EXE,app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),env:{...process.env,PDFSANDWICH_DATA_DIR:profile}});const page=await app.firstWindow();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
async function assertAt(number){await new Promise(r=>setTimeout(r,650));assert.equal((await call('state')).doc.currentPage,number-1);const pages=await page.locator('[data-reader]').evaluateAll(els=>els.map(el=>Number([...el.querySelectorAll('.page-position')].find(p=>p.getBoundingClientRect().bottom>el.getBoundingClientRect().top+5)?.querySelector('.page-number')?.textContent.trim().split(' ')[0])));assert.deepEqual(pages,[number,number]);}
try{
 assert.equal(await page.getByRole('button',{name:'段落对照',exact:true}).count(),0);
 await page.waitForFunction(()=>Boolean(window.pdfsandwich));await call('open',{path:path.resolve('tmp/pdfs/reading-sample.pdf')});await page.waitForFunction(()=>!document.querySelector('.page-rendering'));const doc=(await call('state')).doc;
 await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();await page.getByRole('textbox',{name:'实时 Markdown 编辑器'}).waitFor();
 await call('researchLink',{link:`pdfsandwich://document/${doc.libraryId}?page=3&rect=55,200,500,300`});await assertAt(3);
 const second=path.join(profile,'other.pdf');await fs.copyFile('tmp/pdfs/reading-sample.pdf',second);await call('open',{path:second});await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();await page.getByRole('textbox',{name:'实时 Markdown 编辑器'}).waitFor();
 await call('researchLink',{link:`pdfsandwich://document/${doc.libraryId}?page=4&rect=55,200,500,300`});await assertAt(4);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged:!!exe,noteToDifferentPage:true,noteToDifferentDocument:true,errors}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
