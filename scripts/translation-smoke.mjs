import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
const app=await electron.launch({args:['.'],cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:path.resolve('local-data')},timeout:60000});
try{
  const page=await app.firstWindow();page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const state=await page.evaluate(()=>window.pdfsandwich.call('state'));
  await page.evaluate(settings=>window.pdfsandwich.call('settings',{...settings,provider:'local',autoTranslate:false}),state.settings);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/pdfs/reading-sample.pdf'));
  await page.getByRole('textbox',{name:'当前页码'}).fill('1');
  await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.evaluate(()=>window.pdfsandwich.call('translate',{page:0}));
  let previous='';
  const deadline=Date.now()+12*60*1000;let completed=false;
  while(Date.now()<deadline){
    const snapshot=await page.evaluate(()=>window.pdfsandwich.call('state'));
    const item=snapshot.doc.translations[0];
    const line=JSON.stringify(item);
    if(line!==previous){console.log(line);previous=line;}
    if(item?.status==='error')throw new Error(item.error);
    if(item?.status==='ready'){
      await page.evaluate(()=>window.pdfsandwich.call('stop'));
      await page.waitForFunction(()=>document.querySelector('[data-side="zh"] .textLayer')?.textContent.length>30);
      await page.screenshot({path:'test-results/bilingual.png'});
      await page.getByRole('button',{name:'切换深色主题',exact:true}).click();
      await page.screenshot({path:'test-results/bilingual-dark.png'});
      await page.getByRole('button',{name:'翻译与应用设置'}).click();
      await page.screenshot({path:'test-results/settings-dark.png'});
      console.log('Translation ready: '+item.path);
      await fs.writeFile('test-results/translation.json',JSON.stringify({status:'ready',path:item.path,model:'argos-en-zh-1.9'},null,2));
      completed=true;
      break;
    }
    await new Promise(resolve=>setTimeout(resolve,2000));
  }
  if(!completed)throw new Error('Local translation timed out');
}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
