import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const executable=process.env.PDFSANDWICH_TEST_EXE;
const app=await electron.launch({...(executable?{executablePath:path.resolve(executable)}:{args:['.']}),cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:path.resolve('local-data')},timeout:60000});
let page;
try{
  page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const current=await page.evaluate(()=>window.pdfsandwich.call('state'));
  await page.evaluate(settings=>window.pdfsandwich.call('settings',{...settings,provider:'local',localEngine:'hy',autoTranslate:false,useGlossary:true,glossary:''}),current.settings);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/quality-benchmark/contents.pdf'));
  const start=Date.now();await page.evaluate(()=>window.pdfsandwich.call('translate',{page:0,force:true}));
  let result;const deadline=Date.now()+240000;
  while(Date.now()<deadline){const state=await page.evaluate(()=>window.pdfsandwich.call('state'));const item=state.doc.translations[0];if(item?.status==='error')throw new Error(item.error);if(item?.status==='ready'){result=state;break;}await new Promise(resolve=>setTimeout(resolve,150));}
  if(!result)throw new Error('Quality translation timed out');
  await page.waitForFunction(()=>document.querySelector('[data-side="zh"] .textLayer')?.textContent.includes('运动旋量'));
  const text=await page.locator('[data-side="zh"] .textLayer').textContent();
  for(const word of ['非完整','旋转矩阵','刚体运动'])assert.ok(text.includes(word),`Missing translated term ${word}`);
  assert.equal(result.doc.translations[0].warnings,0);
  await page.evaluate(()=>window.pdfsandwich.call('stop'));
  if(await page.getByRole('button',{name:'切换浅色主题',exact:true}).count())await page.getByRole('button',{name:'切换浅色主题',exact:true}).click();
  await page.screenshot({path:`test-results/quality-bilingual${executable?'-packaged':''}.png`});
  await page.getByRole('button',{name:'翻译与应用设置'}).click();
  await page.getByLabel('本地翻译模型').selectOption('hy');
  await page.getByLabel('自定义术语').fill('twists = 运动旋量');
  await page.screenshot({path:`test-results/quality-settings${executable?'-packaged':''}.png`});
  await page.getByRole('button',{name:'保存设置',exact:true}).click();
  const saved=await page.evaluate(()=>window.pdfsandwich.call('state'));
  assert.equal(saved.settings.glossary,'twists = 运动旋量');assert.deepEqual(saved.doc.translations,{});
  assert.deepEqual(errors,[]);
  const report={packaged:Boolean(executable),seconds:result.doc.translations[0].seconds,elapsedMs:Date.now()-start,terms:true,warnings:0,glossaryInvalidatesCache:true,errors};
  await fs.writeFile(`test-results/quality-ui${executable?'-packaged':''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
  if(page)await page.evaluate(()=>window.pdfsandwich.call('stop')).catch(()=>{});
  await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
}
