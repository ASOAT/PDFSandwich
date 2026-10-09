import {_electron as electron} from 'playwright';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),folder=path.resolve(`tmp/translation-gating-${Date.now()}`);
await fs.mkdir(folder,{recursive:true});
execFileSync(path.resolve('.venv/Scripts/python.exe'),['-c',`
import sys
from pathlib import Path
import pymupdf as f
folder=Path(sys.argv[1])
en='Scientific knowledge develops through observation and testing of useful numerical methods for optimization. '
zh='本文介绍一种数值优化方法，并分析计算效率和算法稳定性。'
with f.open() as d:
 for i in range(2):
  p=d.new_page();p.insert_textbox(f.Rect(40,40,550,700),zh*8,fontname='china-s',fontsize=12)
 image=d[0].get_pixmap().tobytes('png');d.save(folder/'chinese.pdf')
with f.open() as d:
 for i in range(2):
  p=d.new_page();p.insert_image(p.rect,stream=image);p.insert_text((20,780),'Page '+str(i+1))
 d.save(folder/'scan.pdf')
with f.open() as d:
 for i in range(30):
  p=d.new_page()
  if i==7:p.insert_image(p.rect,stream=image)
  else:p.insert_textbox(f.Rect(40,40,550,700),en*3,fontsize=12)
 d.save(folder/'mixed.pdf')
`,folder],{cwd:root});

const app=await electron.launch({...process.env.PDFSANDWICH_EXE?{executablePath:process.env.PDFSANDWICH_EXE}:{args:['.']},cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:path.join(folder,'profile')},timeout:60000});
try {
  await app.evaluate(()=>{
    const cp=process.getBuiltinModule('child_process'),original=cp.ChildProcess.prototype.spawn;
    globalThis.gatingSpawns=[];
    cp.ChildProcess.prototype.spawn=function(options){globalThis.gatingSpawns.push(options.args||[]);return original.call(this,options);};
  });
  const page=await app.firstWindow();page.setDefaultTimeout(30000);
  await page.waitForFunction(()=>Boolean(window.pdfsandwich));
  const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
  const state=await call('state');await call('settings',{...state.settings,autoTranslate:true});
  for(const [file,kind,notice] of [['chinese','chinese','此页为中文，无需翻译'],['scan','needs-ocr','此页需要 OCR，未加载翻译服务']]) {
    await call('open',{path:path.join(folder,file+'.pdf')});
    await call('page',{page:1});await call('translate',{all:true});
    await page.getByText(notice,{exact:true}).first().waitFor();
    await page.waitForFunction(()=>{
      const surface=document.querySelector('[data-side="en"]');
      return surface?.querySelector('canvas')?.width>100&&!surface.querySelector('.page-rendering,.page-error');
    });
    const current=await call('state');
    assert.equal(current.doc.translationProfile.kind,kind);assert.equal(current.queued,0);assert.equal(current.translating,false);
    await page.screenshot({path:path.join(folder,file+'.png')});
  }
  await call('settings',{...state.settings,autoTranslate:false});
  await call('open',{path:path.join(folder,'mixed.pdf')});
  assert.equal((await call('state')).doc.pages[7].translationKind,undefined);
  await call('translate',{page:7,force:true});
  await page.waitForFunction(async()=>{const s=await window.pdfsandwich.call('state');return s.doc.pages[7].translationKind==='needs-ocr'&&!s.translating;});
  const spawned=await app.evaluate(()=>globalThis.gatingSpawns);
  assert(spawned.some(args=>args.some(arg=>/worker\.py|pdfsandwich-worker\.exe/.test(arg))));
  assert(!spawned.some(args=>args.includes('--translate')||args.includes('--translate-server')));
  assert.equal((await call('state')).queued,0);
  console.log(JSON.stringify({chinese:true,scanned:true,unsampledMixedPage:true,translationProcesses:0,folder}));
} finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}
