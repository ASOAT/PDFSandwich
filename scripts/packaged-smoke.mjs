import {_electron as electron} from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
const app=await electron.launch({executablePath:path.resolve('release/win-unpacked/PDFSandwich.exe'),
  env:{...process.env,PDFSANDWICH_DATA_DIR:path.resolve('local-data/packaged-test')},timeout:60000});
try{
  const page=await app.firstWindow();page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const cfg=await page.evaluate(()=>window.pdfsandwich.call('state'));
  if(cfg.settings.provider!=='local'||cfg.settings.hasKey)throw new Error('Packaged defaults must be local, with no credentials');
  await page.evaluate(s=>window.pdfsandwich.call('settings',{...s,autoTranslate:false}),cfg.settings);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/pdfs/rotated-sample.pdf'));
  await page.getByRole('textbox',{name:'当前页码'}).fill('2');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-page="2"] .textLayer')?.textContent.length>30);
  await page.screenshot({path:'test-results/packaged-rotated.png'});
  await fs.mkdir('local-data/packaged-test/models',{recursive:true});
  await fs.cp('local-data/models/argos-en-zh-1.9','local-data/packaged-test/models/argos-en-zh-1.9',{recursive:true});
  await page.getByRole('textbox',{name:'当前页码'}).fill('1');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.evaluate(()=>window.pdfsandwich.call('translate',{page:0}));
  const start=Date.now();let success=false;
  while(Date.now()-start<180000){const s=await page.evaluate(()=>window.pdfsandwich.call('state'));const t=s.doc.translations[0];if(t?.status==='error')throw new Error(t.error);if(t?.status==='ready'){success=true;break;}await new Promise(r=>setTimeout(r,500));}
  await page.evaluate(()=>window.pdfsandwich.call('stop'));
  if(!success)throw new Error('Packaged translation timed out');
  await page.waitForFunction(()=>document.querySelector('[data-page="1"][data-side="zh"] .textLayer')?.textContent.length>30);
  await page.screenshot({path:'test-results/packaged-bilingual.png'});
  const report={packaged:true,rotatedPage:true,realLocalTranslation:true,translationMs:Date.now()-start};
  await fs.writeFile('test-results/packaged.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
