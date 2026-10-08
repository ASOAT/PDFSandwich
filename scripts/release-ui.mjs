import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=process.cwd(),exe=process.env.PDFSANDWICH_TEST_EXE;
const data=await fs.mkdtemp(path.resolve('local-data/release-ui-'));
await fs.symlink(path.resolve('local-data/models'),path.join(data,'models'),'junction');
const file=path.join(data,'Learning from data.pdf');
await fs.copyFile('tmp/pdfs/release-sample.pdf',file);
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,
  env:{...process.env,PDFSANDWICH_DATA_DIR:data},timeout:60000});
let page;
try {
  page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1500,960));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const call=(op,args)=>page.evaluate(({op,args})=>window.pdfsandwich.call(op,args),{op,args});
  async function until(check,timeout=180000){const end=Date.now()+timeout;while(Date.now()<end){const s=await call('state');if(s.doc?.translations[0]?.status==='error')throw new Error(s.doc.translations[0].error);if(check(s))return s;await new Promise(r=>setTimeout(r,100));}throw new Error('State timed out');}
  let s=await call('state');
  await call('settings',{...s.settings,provider:'local',localEngine:'hy',autoTranslate:false,glossary:'',useGlossary:true});
  assert.equal(await page.getByText('专注阅读',{exact:false}).count(),0);
  await call('open',{path:file});await call('translate',{page:0});
  s=await until(s=>s.doc.translations[0]?.status==='ready');
  const seconds=s.doc.translations[0].seconds;
  const paragraphs=await call('researchParagraphs',{page:0});assert.ok(paragraphs.some(p=>p.source&&/[\u4e00-\u9fff]/.test(p.target)));
  const record=await call('notesForDocument',{documentId:s.doc.libraryId});assert.ok(record.documentId);
  await page.waitForFunction(()=>document.querySelector('[data-side="zh"] .textLayer')?.textContent.includes('神经网络')&&!document.querySelector('.page-rendering'));
  async function select(side,needle,tool) {
    await page.getByRole('button',{name:tool,exact:true}).click();
    await page.evaluate(({side,needle})=>{
      const layer=document.querySelector(`[data-side="${side}"] .textLayer`);
      const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT),nodes=[];let node,text='';
      while(node=walker.nextNode()){nodes.push([node,text.length]);text+=node.textContent;}
      const start=text.toLowerCase().indexOf(needle.toLowerCase());if(start<0)throw new Error(`Selection missing: ${needle}`);
      const end=start+needle.length,range=document.createRange();
      const a=nodes.findLast(([,offset])=>offset<=start),b=nodes.findLast(([,offset])=>offset<end);
      range.setStart(a[0],start-a[1]);range.setEnd(b[0],end-b[1]);
      const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
      layer.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    },{side,needle});
  }
  await select('en','neural network','高亮文字');
  s=await until(s=>s.doc.annotations[0]?.accuracy==='phrase');assert.ok(s.doc.annotations[0].zh.rects.length);
  const extracted=await call('researchExcerpt',{items:[s.doc.annotations[0]]});assert.match(extracted[0].source,/neural network/i);assert.match(extracted[0].translation,/神经网络/);
  const excerpt=await call('notesExcerpt',{excerpts:extracted,thought:'Keep this definition.'});assert.match(excerpt.note.content,/神经网络/);
  await select('zh','梯度下降','下划线');
  s=await until(s=>s.doc.annotations[1]?.accuracy==='phrase');assert.ok(s.doc.annotations[1].en.rects.length);
  await call('annotate',{item:{id:'sample-note',page:0,kind:'note',origin:'en',en:{rects:[[515,185,533,203]]},color:'#83a96b',width:1.6,content:'Review this concept.',accuracy:'pending'}});
  await until(s=>s.doc.annotations[2]?.zh);
  await call('editAnnotation',{id:'sample-note',content:'Revisit the training example.'});
  await call('save');
  // Re-layout must remap a Chinese-origin mark from its stable English anchor.
  await call('translate',{page:0,force:true});
  s=await until(s=>s.doc.translations[0]?.status==='ready'&&s.doc.annotations[1]?.accuracy==='phrase'&&s.doc.annotations[1]?.zh);
  await call('save');await call('open',{path:file});
  s=await call('state');assert.equal(s.doc.annotations.length,3);assert.equal(s.doc.annotations[2].content,'Revisit the training example.');
  assert.ok(s.doc.annotations.every(a=>a.en&&a.zh));
  await page.waitForFunction(()=>!document.querySelector('.page-rendering')&&document.querySelectorAll('.pdf-surface canvas').length===2);
  if(await page.getByRole('button',{name:'切换浅色主题',exact:true}).count())await page.getByRole('button',{name:'切换浅色主题',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  const samplePixels=()=>page.evaluate(()=>[...document.querySelectorAll('.pdf-surface canvas')].map(c=>{const data=c.getContext('2d').getImageData(10,10,1,1).data;return [...data];}));
  const light=await samplePixels();assert.ok(light.every(p=>p[0]>240&&p[1]>240&&p[2]>240));
  const target=exe?'test-results':'docs';
  await page.screenshot({path:`${target}/reader-light.png`});
  await page.getByRole('button',{name:'切换深色主题',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.page-rendering'));
  const dark=await samplePixels();assert.ok(dark.every(p=>p[0]<35&&p[1]<35&&p[2]<35));
  assert.ok(await page.locator('.mark-layer [data-mark-id]').count()>=6);
  await page.screenshot({path:`${target}/reader-dark.png`});
  const report={packaged:Boolean(exe),seconds,light,dark,paragraphPairs:true,bilingualExcerpt:true,bidirectionalMarks:true,noteTextShared:true,retranslateRestored:true,saveReopen:true,errors,translated:s.doc.translations[0].path};
  await fs.writeFile(`test-results/release-ui${exe?'-packaged':''}.json`,JSON.stringify(report,null,2));
  assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
} finally {
  if(page)await page.evaluate(()=>window.pdfsandwich.call('stop')).catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
