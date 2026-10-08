import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve('docs');
const server=http.createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html')));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try {const body=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(body);}
  catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'light'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('#app-preview').evaluate(img=>img.decode());
  assert.equal(await page.title(),'PDFSandwich — 开源中英对照 PDF 阅读器与离线翻译');
  assert.equal(await page.locator('.download').first().getAttribute('href'),'https://github.com/ASOAT/PDFSandwich/releases/download/v0.6.1/PDFSandwich-Setup-0.6.1.exe');
  await page.screenshot({path:'test-results/site-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'深色',exact:true}).click();
  assert.equal(await page.locator('#app-preview').getAttribute('src'),'reader-dark.png');
  await page.getByRole('button',{name:'切换深色主题'}).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.screenshot({path:'test-results/site-dark.png',fullPage:true});
  const widths=[360,390,768,1024,1440];
  for(const width of widths){
    await page.setViewportSize({width,height:900});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
    assert.equal(overflow,false,`Horizontal overflow at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'切换浅色主题'}).click();
  await page.getByText('翻译和标记能完全对应吗？',{exact:true}).click();
  assert.equal(await page.locator('details[open]').count(),1);
  await page.screenshot({path:'test-results/site-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({responsiveWidths:widths,themePersistence:true,previewTabs:true,downloadLink:true,errors}));
} finally {await browser.close();await new Promise(r=>server.close(r));}
