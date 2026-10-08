import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
const root=process.cwd(),report=JSON.parse(await fs.readFile('test-results/release-ui-packaged.json','utf8'));
const profile=report.translated.split(path.sep+'documents'+path.sep)[0];if(!profile.startsWith(path.join(root,'local-data')+path.sep))throw new Error('Expected isolated release profile');
execFileSync(path.resolve('.venv/Scripts/python.exe'),['scripts/demo-gallery.py']);
const app=await electron.launch({args:['.'],cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile}}),page=await app.firstWindow();page.setDefaultTimeout(30000);
const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
try{
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,960));await page.waitForFunction(()=>Boolean(window.pdfsandwich));
 await page.evaluate(()=>{localStorage.setItem('theme','light');localStorage.setItem('palette','monet');window.dispatchEvent(new Event('appearance'));});
 await call('libraryImport',{paths:[1,2,3,4,5].map(i=>path.resolve('tmp/gallery',`cover-${i}.pdf`))});
 let lib=await call('libraryState');
 await call('libraryCollection',{name:'机器学习'});await call('libraryCollection',{name:'控制与机器人'});lib=await call('libraryState');
 const learning=lib.documents.find(d=>d.title.includes('Learning from data'));
 for(const doc of lib.documents)await call('libraryEdit',{id:doc.id,changes:{year:'2026',tags:doc.title.includes('Learning')?['机器学习','待阅读']:['阅读笔记'],collections:[lib.collections[doc.title.includes('Learning')?0:1].id]}});
 await page.getByRole('button',{name:'文献库',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.library-cover img').length>=6&&[...document.querySelectorAll('.library-cover img')].every(e=>e.complete&&e.naturalWidth>0));
 await page.screenshot({path:'docs/library-light.png'});
 await call('libraryOpen',{id:learning.id});await page.waitForFunction(()=>!document.querySelector('.page-rendering')&&document.querySelectorAll('.pdf-surface canvas').length===2);
 await page.screenshot({path:'docs/reader-light.png'});await page.getByRole('button',{name:'切换深色主题'}).click();await page.waitForFunction(()=>!document.querySelector('.page-rendering'));await page.screenshot({path:'docs/reader-dark.png'});await page.getByRole('button',{name:'切换浅色主题'}).click();
 const note=await call('notesForDocument',{documentId:learning.id});const header=note.content.match(/^---\n[\s\S]*?\n---\n/)[0];
 const body=`\n# Learning from data\n\n## 核心概念\n\n**神经网络**通过训练调整参数，学习输入与输出之间的关系。每一层组合输入，并把结果传给下一层。\n\n> A neural network learns patterns from data.\n>\n> 神经网络从数据中学习模式。\n\n[第 1 页 · 返回原文](pdfsandwich://document/${learning.id}?page=1&rect=55,211,540,300)\n\n## 个人思考\n\n梯度下降可以写成：\n\n$$\n\\theta_{t+1}=\\theta_t-\\eta\\nabla_{\\theta}L(\\theta_t)\n$$\n\n- 学习率决定每一步更新的大小。\n- 验证数据应与训练数据保持分离。\n- [ ] 对比不同学习率的收敛过程。\n\n`;
 await call('notesSave',{id:note.id,version:note.version,base:note.content,content:header+body});await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();await page.locator('.live-math-block .katex').waitFor();
 const handle=await page.getByRole('separator',{name:'调整笔记宽度'}).boundingBox();await page.mouse.move(handle.x+2,handle.y+120);await page.mouse.down();await page.mouse.move(880,handle.y+120,{steps:8});await page.mouse.up();
 await page.waitForFunction(()=>!document.querySelector('.page-rendering'));await page.screenshot({path:'docs/notes-light.png'});
 console.log(JSON.stringify({screenshots:['reader-light','reader-dark','library-light','notes-light'],originalContent:true}));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
