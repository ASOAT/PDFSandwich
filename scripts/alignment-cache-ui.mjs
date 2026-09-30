// Read-only fixture input; every save is made to a private test copy.
// Fixture: source.pdf, zh.pdf, alignment.json, draft.json, expectations.json.
import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), fixture=path.resolve(process.env.PDFSANDWICH_ALIGNMENT_FIXTURE || 'tmp/alignment-fixture');
const expected=JSON.parse(await fs.readFile(path.join(fixture,'expectations.json'),'utf8'));
const oldDraft=JSON.parse(await fs.readFile(path.join(fixture,'draft.json'),'utf8'));
const profile=await fs.mkdtemp(path.join(root,'local-data','alignment-cache-ui-'));
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
const file=path.join(profile,'Cached annotations.pdf');await fs.copyFile(path.join(fixture,'source.pdf'),file);
const exe=process.env.PDFSANDWICH_TEST_EXE;
const app=await electron.launch({...(exe?{executablePath:path.resolve(exe)}:{args:['.']}),cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
try {
  const page=await app.firstWindow();
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1800,1150));
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
  let state=await call('state');await call('settings',{...state.settings,autoTranslate:false,provider:'local'});
  await call('open',{path:file});state=await call('state');
  const draftFile=path.join(profile,'documents',state.doc.id,'draft.json');
  const draft=JSON.parse(await fs.readFile(draftFile,'utf8'));
  draft.annotations=oldDraft.annotations.filter(item=>item.page===expected.page);
  const manual={...draft.annotations[0],id:'manual-preserved',accuracy:'manual'};
  draft.annotations.push(manual);draft.page=expected.page;draft.zoom=.9;
  draft.translations[expected.page]={path:path.join(fixture,'zh.pdf'),status:'ready',warnings:0,qualityVersion:7};
  await fs.writeFile(draftFile,JSON.stringify(draft));await call('open',{path:file});
  async function until(check) {
    const end=Date.now()+30000;
    while(Date.now()<end){const s=await call('state');if(check(s))return s;await new Promise(resolve=>setTimeout(resolve,50));}
    throw new Error('Cached annotation remapping timed out');
  }
  state=await until(s=>s.doc.annotations.every(mark=>mark.accuracy==='manual'||mark.mappingVersion===3));
  assert.deepEqual(state.doc.annotations.find(mark=>mark.id===manual.id),manual);
  const mapped=state.doc.annotations.filter(mark=>mark.accuracy!=='manual');
  function check(mark,side) {
    const box=expected[mark.kind][side];
    assert.ok(mark[side]?.rects.length>=expected[mark.kind].minimumRects);
    for(const r of mark[side].rects)assert.ok(r[0]>=box[0]&&r[1]>=box[1]&&r[2]<=box[2]&&r[3]<=box[3],JSON.stringify({kind:mark.kind,side,r,box}));
  }
  for(const mark of mapped) {
    check(mark,'zh');
    assert.deepEqual(mark.en,oldDraft.annotations.find(old=>old.id===mark.id).en);
  }
  // Remove the deliberately incorrect manual copy before taking the screenshot.
  await call('editAnnotation',{id:manual.id,remove:true});
  await page.getByRole('textbox',{name:'当前页码'}).fill(String(expected.page+1));
  await page.getByRole('textbox',{name:'当前页码'}).press('Enter');
  await page.waitForFunction(p=>document.querySelector(`[data-side="zh"][data-page="${p+1}"] .textLayer`)?.textContent.length>50,expected.page);
  await page.screenshot({path:'test-results/alignment-cache-fixed.png'});
  for(const mark of mapped) {
    const reverse={...mark,id:`reverse-${mark.id}`,origin:'zh',selectedText:undefined,en:undefined,mappingVersion:undefined,accuracy:'pending'};
    await call('annotate',{item:reverse});
  }
  state=await until(s=>s.doc.annotations.filter(mark=>mark.origin==='zh').length===mapped.length&&s.doc.annotations.every(mark=>mark.mappingVersion===3));
  for(const mark of state.doc.annotations.filter(mark=>mark.origin==='zh'))check(mark,'en');
  await call('save');await call('open',{path:file});state=await call('state');
  assert.equal(state.doc.dirty,false);assert.equal(state.doc.annotations.length,mapped.length*2);
  assert.ok(state.doc.annotations.every(mark=>mark.en&&mark.zh&&mark.mappingVersion===3));assert.deepEqual(errors,[]);
  const report={packaged:!!exe,cachedMarksRemapped:mapped.length,manualPreserved:true,noCrossParagraphMarks:true,mathIncluded:true,reverseMapping:true,saveReopen:true,errors};
  await fs.writeFile('test-results/alignment-cache-ui.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {await app.evaluate(({app})=>app.exit(0)).catch(()=>{});}

