import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),profile=await fs.mkdtemp(path.join(root,'local-data/live-notes-'));
const mode=process.env.PDFSANDWICH_NOTES_MODE||'standalone';
if(mode==='obsidian'){const vault=path.join(profile,'Vault');await fs.mkdir(vault);await fs.writeFile(path.join(profile,'notes-settings.json'),JSON.stringify({mode:'obsidian',vault,notesFolder:'Papers'}));}
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
const app=await electron.launch({...(process.env.PDFSANDWICH_TEST_EXE?{executablePath:path.resolve(process.env.PDFSANDWICH_TEST_EXE)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile}}),page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
 await page.getByRole('button',{name:'笔记',exact:true}).click();await page.getByTitle('新建笔记').click();await page.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'源码',exact:true}).click();const source=page.getByRole('textbox',{name:'Markdown 编辑器'}),initial=await source.inputValue();
 let body='\n## Live heading\n\n**Bold phrase** and *italic phrase*.\n\n> A quoted conclusion\n\n- [ ] Read the experiment\n\n$$\n\\frac{x^2}{a^2}-\\frac{y^2}{b^2}=1\n$$\n\n| Method | Result |\n| --- | --- |\n| Local | Fast |\n\nFinal line.\n';
 if(mode==='obsidian'){const cfg=await call('researchSettings');await fs.mkdir(path.join(cfg.vault,'Images'));await fs.writeFile(path.join(cfg.vault,'Images','Shared.png'),Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lDQAAAAASUVORK5CYII=','base64'));body+='\n![[Shared.png]]\n';}
 await source.fill(initial+body);await page.getByTitle('立即保存').click();const notes=await call('notesList');const note=await call('notesGet',{id:notes[0].id});
 await page.getByRole('button',{name:'实时编辑',exact:true}).click();await page.locator('.live-math-block .katex').waitFor();
 if(mode==='obsidian')await page.waitForFunction(()=>document.querySelector('.live-image img')?.naturalWidth>0);assert.ok(await page.locator('.live-table table').count());assert.ok(await page.locator('.live-strong').count());assert.ok(await page.locator('.live-heading').count());await page.screenshot({path:'test-results/live-markdown.png'});
 const live=page.getByRole('textbox',{name:'实时 Markdown 编辑器'});await live.click();await live.press('Control+End');await live.press('End');await live.press('Enter');await live.pressSequentially('A live editor addition.');await live.press('Control+s');
 await page.waitForFunction(async id=>(await window.pdfsandwich.call('notesGet',{id})).content.includes('A live editor addition.'),note.id);
 const current=await call('notesGet',{id:note.id});assert.ok(current.content.startsWith(initial));assert.ok(current.content.includes('\\frac{x^2}'));
 const nextWindow=app.waitForEvent('window');await call('notesPopout',{id:note.id});const child=await nextWindow;child.on('pageerror',e=>errors.push(e.message));const childEditor=child.getByRole('textbox',{name:'实时 Markdown 编辑器'});await childEditor.waitFor();
 await childEditor.click();await childEditor.press('Control+End');await childEditor.press('Enter');await childEditor.pressSequentially('Floating window addition.');
 await child.evaluate(()=>window.close());await page.waitForFunction(async id=>(await window.pdfsandwich.call('notesGet',{id})).content.includes('Floating window addition.'),note.id);
 const config=await call('researchSettings'),file=path.join(config.root,note.relative);await fs.appendFile(file,'\nExternal editor appended.\n');await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('External editor appended.'));
 const snapshot=(await call('notesGet',{id:note.id})).content;await page.getByRole('button',{name:'阅读与笔记设置',exact:true}).click();
 for(const palette of ['莫奈','维米尔','莫兰迪']){await page.getByRole('button',{name:new RegExp(palette)}).click();for(const mode of ['浅色','深色']){await page.getByRole('button',{name:mode,exact:true}).click();await page.screenshot({path:`test-results/palette-${palette}-${mode}.png`});}}
 await page.getByRole('button',{name:'关闭笔记设置'}).click();assert.equal((await call('notesGet',{id:note.id})).content,snapshot);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({profile,mode,table:true,liveHeading:true,bold:true,formula:true,rawMarkdownUnchanged:true,liveAutosave:true,popoutCloseFlush:true,externalEdits:true,sixThemes:true}));
}catch(error){await page.screenshot({path:'test-results/live-notes-failure.png'}).catch(()=>{});throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
