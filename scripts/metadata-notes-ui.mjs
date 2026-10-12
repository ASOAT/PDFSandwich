import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const root=process.cwd(),title='A comprehensive study of scientific document workflows and reproducible reading with detailed findings across multiple research areas';
const profile=await fs.mkdtemp(path.join(root,'local-data/metadata-notes-ui-'));
const source=path.join(profile,'sample.pdf');
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['-c',`import sys,pymupdf as f\nd=f.open();p=d.new_page();p.insert_text((40,35),'JOURNAL OF SOFTWARE SYSTEMS',fontsize=9);p.insert_textbox(f.Rect(40,80,550,200),sys.argv[2],fontsize=18);p.insert_text((40,240),'DOI: 10.1000/metadata-fixture',fontsize=10);d.set_metadata({'title':'Microsoft Word - manuscript.docx'});d.save(sys.argv[1])`,source,title]);
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false}));
const exe=process.env.PDFSANDWICH_TEST_EXE;
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
const page=await app.firstWindow(),errors=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
  await page.getByRole('heading',{name:'全部文献'}).waitFor();
  const imported=await call('libraryImport',{paths:[source]}),id=imported.imported[0];
  const identity=await call('metadataIdentify',{id});assert.equal(identity.title,title);assert.equal(identity.doi,'10.1000/metadata-fixture');
  // The real network adapters have their own live checks. Keep UI automation
  // deterministic and ensure no document content leaves this isolated profile.
  await app.evaluate(({app},{title})=>{
    const require=process.getBuiltinModule('module').createRequire(app.getAppPath()+'/package.json'),path=require('node:path'),module=require(path.join(app.getAppPath(),'electron/metadata.cjs'));
    module.lookup=async(query,options)=>{globalThis.__metadataQuery={query,options};return [{title,authors:'Ada Lovelace; Alan Turing',year:'2025',doi:'10.1000/metadata-fixture',journal:'Research Systems',abstract:'A public test fixture.',url:'https://example.org/paper',bibtex:'@article{test, title={'+title+'}}',provider:'Crossref'}];};
  },{title});
  await page.getByRole('button',{name:'文献库',exact:true}).click();
  await page.locator('.library-grid-card').first().click({button:'right'});
  await page.getByRole('menuitem',{name:'检索元数据…',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[aria-label="DOI 或文献标题"]').value==='10.1000/metadata-fixture');
  await page.getByRole('button',{name:'检索',exact:true}).click();
  await page.locator('.metadata-results button').first().click();
  const sent=await app.evaluate(()=>globalThis.__metadataQuery);assert.equal(sent.options.titles[0],title);
  await page.getByRole('button',{name:'更新所选字段',exact:true}).click();
  await page.getByRole('dialog',{name:'检索文献元数据'}).waitFor({state:'detached'});
  const note=await call('notesForDocument',{documentId:id});assert.equal(note.title,title);assert.equal(note.content,'');
  // This deliberately deep isolated profile may shorten the disk filename;
  // the full title must survive creation, display and a later save either way.
  await call('libraryOpen',{id});await page.locator('[data-side="en"] .textLayer span').first().waitFor();
  await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();
  await page.getByRole('button',{name:'源码',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Markdown 编辑器'});await editor.fill('My handwritten text stays intact.');await page.getByTitle('立即保存').click();
  await page.waitForFunction(title=>document.querySelector('.notes-heading strong')?.title===title,title);
  await page.getByTitle('重命名 / 分类').click();assert.equal(await page.getByRole('textbox',{name:'笔记标题',exact:true}).inputValue(),title);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  const saved=await call('notesForDocument',{documentId:id});assert.equal(saved.title,title);assert.match(saved.content,/My handwritten text/);
  await page.screenshot({path:'test-results/metadata-notes.png'});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({packaged:Boolean(exe),titleExtraction:true,metadataApply:true,titleFallbackSent:true,longNoteTitle:true,savedContent:true,errors}));
}catch(error){await page.screenshot({path:'test-results/metadata-notes-failure.png'}).catch(()=>{});throw error;}
finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
