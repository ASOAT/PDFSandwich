import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';
const profile=await fs.mkdtemp(path.resolve('local-data/notes-template-')),vault=path.join(profile,'Vault 中文');
await fs.mkdir(path.join(vault,'Templates'),{recursive:true});await fs.mkdir(path.join(vault,'.pdfsandwich'));
const settings=path.join(vault,'.pdfsandwich/config.json');await fs.writeFile(settings,JSON.stringify({version:1,notesFolder:'03Literature',templateFile:''}));
await fs.writeFile(path.join(profile,'notes-settings.json'),JSON.stringify({mode:'obsidian',vault,notesFolder:'03Literature'}));await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false}));
const exe=process.env.PDFSANDWICH_TEST_EXE,app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),env:{...process.env,PDFSANDWICH_DATA_DIR:profile}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
 await page.waitForFunction(()=>Boolean(window.pdfsandwich));await app.evaluate(({shell})=>{shell.openExternal=async uri=>{globalThis.testObsidianUri=uri;};});
 await call('open',{path:path.resolve('tmp/pdfs/reading-sample.pdf')});const doc=(await call('state')).doc;
 await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();await page.getByRole('textbox',{name:'实时 Markdown 编辑器'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'段落对照',exact:true}).count(),0);
 const blank=await call('notesForDocument',{documentId:doc.libraryId});assert.equal(blank.content,'');assert.equal(blank.documentId,doc.libraryId);
 await page.getByRole('button',{name:'源码',exact:true}).click();const editor=page.getByRole('textbox',{name:'Markdown 编辑器'});await editor.fill('# My own heading\n\nUnflushed idea');
 await page.getByRole('button',{name:'在 Obsidian 打开',exact:true}).click();
 const uri=await app.evaluate(()=>globalThis.testObsidianUri);assert.equal(new URL(uri).searchParams.get('path'),path.join(vault,'03Literature',blank.relative));assert.match((await call('notesGet',{id:blank.id})).content,/Unflushed idea/);
 const template='---\ntitle: "{{title}}"\n---\n# {{title}}\n\n## My template section\n\n{{date}}\n';await fs.writeFile(path.join(vault,'Templates','Paper.md'),template);
 await fs.writeFile(settings,JSON.stringify({version:1,notesFolder:'03Literature',templateFile:'Templates/Paper.md'}));
 for(let attempt=0;attempt<100&&(await call('researchSettings')).templateFile!=='Templates/Paper.md';attempt++)await new Promise(r=>setTimeout(r,50));
 assert.equal((await call('researchSettings')).templateFile,'Templates/Paper.md');
 const created=await call('notesCreate',{title:'Template result'});assert.match(created.content,/# Template result/);assert.doesNotMatch(created.content,/pdfsandwich_note_id/);
 await page.getByRole('button',{name:'笔记',exact:true}).click();await page.getByRole('button',{name:/Template result/}).click();await page.getByRole('button',{name:'实时编辑',exact:true}).click();await page.locator('.live-heading').first().waitFor();
 await page.screenshot({path:'test-results/notes-template.png'});
 assert.match((await call('notesGet',{id:blank.id})).content,/Unflushed idea/);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({packaged:!!exe,defaultEmpty:true,obsidianUri:true,flushBeforeOpen:true,liveTemplate:true,existingNoteUnchanged:true,paragraphViewRemoved:true,errors}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
