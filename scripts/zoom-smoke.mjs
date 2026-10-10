import {_electron as electron} from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const executable=process.env.PDFSANDWICH_TEST_EXE;
const profile=await fs.mkdtemp(path.resolve('local-data/zoom-test-'));
const app=await electron.launch({...(executable?{executablePath:path.resolve(executable)}:{args:['.']}),cwd:process.cwd(),env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
try{
  const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const cfg=await page.evaluate(()=>window.pdfsandwich.call('state'));
  await page.evaluate(s=>window.pdfsandwich.call('settings',{...s,provider:'local',autoTranslate:false}),cfg.settings);
  await page.evaluate(file=>window.pdfsandwich.call('open',{path:file}),path.resolve('tmp/pdfs/reading-sample.pdf'));
  await page.getByRole('textbox',{name:'当前页码'}).fill('4');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-side="en"][data-page="4"] .textLayer')?.textContent.length>30);
  const header=await page.locator('.app-header').boundingBox();
  const original=await page.locator('[data-side="en"][data-page="4"]').boundingBox();
  const mouse={x:original.x+original.width*.55,y:original.y+original.height*.4};
  await page.mouse.move(mouse.x,mouse.y);await page.keyboard.down('Control');await page.mouse.wheel(0,-120);await page.keyboard.up('Control');
  await page.waitForFunction(width=>document.querySelector('[data-side="en"][data-page="4"]').getBoundingClientRect().width>width*1.1,original.width);
  const enlarged=await page.locator('[data-side="en"][data-page="4"]').boundingBox();
  const anchorError=Math.abs((mouse.y-enlarged.y)/enlarged.height-.4);
  const horizontalAnchorError=Math.abs((mouse.x-enlarged.x)/enlarged.width-.55);
  if(anchorError>.012||horizontalAnchorError>.012)throw new Error(`Zoom moved pointer anchor: ${anchorError}, ${horizontalAnchorError}`);
  const right=await page.locator('[data-reader="zh"]').boundingBox();
  const label=await page.locator('.zoom-value').textContent();
  await page.mouse.move(right.x+right.width*.5,right.y+right.height*.45);await page.keyboard.down('Control');await page.mouse.wheel(0,120);await page.keyboard.up('Control');
  await page.waitForFunction(old=>document.querySelector('.zoom-value').textContent!==old,label);
  const shrunk=await page.locator('[data-side="en"][data-page="4"]').boundingBox();
  if(Math.abs(shrunk.width-original.width)>2)throw new Error('Right-side zoom did not apply to both panes');
  const normalLabel=await page.locator('.zoom-value').textContent();
  const oldTop=await page.locator('[data-reader="zh"]').evaluate(el=>el.scrollTop);
  await page.mouse.wheel(0,220);
  await page.waitForFunction(top=>document.querySelector('[data-reader="zh"]').scrollTop>top+100,oldTop);
  await page.waitForFunction(()=>Math.abs(document.querySelector('[data-reader="en"]').scrollTop-document.querySelector('[data-reader="zh"]').scrollTop)<3);
  if(await page.locator('.zoom-value').textContent()!==normalLabel)throw new Error('Normal wheel unexpectedly zoomed');
  const afterHeader=await page.locator('.app-header').boundingBox();
  const browserZoom=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getZoomFactor());
  if(header.height!==afterHeader.height||browserZoom!==1)throw new Error('Whole application was magnified');
  await page.screenshot({path:`test-results/ctrl-wheel${executable?'-packaged':''}.png`});
  const gutters=[];
  async function pageFour(){
    await page.getByRole('textbox',{name:'当前页码'}).fill('4');await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
    await page.waitForFunction(()=>Boolean(document.querySelector('[data-side="en"][data-page="4"] .textLayer span')));
  }
  await page.keyboard.press('Control+0');
  for(const target of [50,70,100]){
    await page.keyboard.press('Control+0');
    for(let i=100;i>target;i-=10)await page.keyboard.press('Control+-');
    await page.waitForFunction(value=>document.querySelector('.zoom-value').textContent===(value===100?'适合页宽':`${value}%`),target);
    await pageFour();
    const gap=await page.evaluate(()=>{
      const find=side=>document.querySelector(`[data-reader="${side}"] .page-position:has([data-page="4"])`) || [...document.querySelectorAll(`[data-reader="${side}"] .page-position`)].find(p=>p.querySelector('.page-number')?.textContent.trim().startsWith('4 '));
      const left=find('en').getBoundingClientRect(),right=find('zh').getBoundingClientRect();
      return right.left-left.right;
    });
    if(gap<20||gap>36)throw new Error(`Unexpected center gap at ${target}%: ${gap}`);
    gutters.push({zoom:target,gap});
    if(target===50)await page.screenshot({path:'test-results/paired-50.png'});
  }
  if(Math.max(...gutters.map(x=>x.gap))-Math.min(...gutters.map(x=>x.gap))>2)throw new Error('Center gap grows when zooming out');
  await page.getByRole('button',{name:'PDF 与笔记',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-reader]').length===1);
  await page.keyboard.press('Control+-');await page.keyboard.press('Control+-');
  await pageFour();
  const noteCenterError=await page.evaluate(()=>{
    const viewport=document.querySelector('[data-reader="en"]');
    const surface=viewport.querySelector('[data-page="4"]').getBoundingClientRect();
    return Math.abs((surface.left+surface.right)/2-(viewport.getBoundingClientRect().left+viewport.clientWidth/2));
  });
  if(noteCenterError>2)throw new Error(`Single PDF notes view is not centered: ${noteCenterError}`);
  await page.getByRole('button',{name:'双栏原文译文',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-reader]').length===2);
  if(errors.length)throw new Error(errors.join('; '));
  const report={packaged:Boolean(executable),leftZoomIn:true,rightZoomOut:true,normalScroll:true,gutters,noteCenterError,pointerAnchorError:anchorError,horizontalAnchorError,browserZoom,errors};
  await fs.writeFile(`test-results/ctrl-wheel${executable?'-packaged':''}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}catch(error){const p=await app.firstWindow();console.log(await p.evaluate(async()=>({state:await window.pdfsandwich.call('state'),readers:[...document.querySelectorAll('[data-reader]')].map(e=>({side:e.dataset.reader,top:e.scrollTop,width:e.clientWidth,pages:[...e.querySelectorAll('[data-page]')].map(p=>p.dataset.page)}))})));await p.screenshot({path:'test-results/zoom-failure.png'});throw error;}finally{await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
