const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {TranslationFileSaver,snapshotTranslation,availableTranslationPath}=require('../electron/translation-file.cjs');
const {cacheKey,validSettings}=require('../electron/core.cjs');
test('per-page snapshots avoid unchanged writes and preserve pre-existing same-name files',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'translation-file-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'paper.pdf'),part=path.join(root,'part.pdf');fs.writeFileSync(part,'page');fs.writeFileSync(source,'source');fs.writeFileSync(path.join(root,'paper.zh.pdf'),'user file');
 const doc={path:source,pages:[{},{}],translations:{0:{status:'ready',path:part}},annotations:[],cacheVersion:'v',stamp:{}};
 const snap=snapshotTranslation(doc);assert.equal(path.basename(snap.args.output),'paper.zh (2).pdf');assert.deepEqual(snap.args.changed_pages,[0,1]);
 fs.writeFileSync(snap.args.output,'saved copy');const stat=fs.statSync(snap.args.output,{bigint:true});
 doc.translationFile={path:snap.args.output,stamp:{size:String(stat.size),mtime:String(stat.mtimeNs)},signatures:snap.signatures};assert.equal(snapshotTranslation(doc),null);
 doc.annotations.push({page:1,id:'new'});assert.deepEqual(snapshotTranslation(doc).args.changed_pages,[1]);assert.equal(fs.readFileSync(path.join(root,'paper.zh.pdf'),'utf8'),'user file');
 assert.equal(path.basename(availableTranslationPath(source)),'paper.zh (3).pdf');
 const config={provider:'local',baseUrl:'https://api.deepseek.com',model:'example',autoTranslate:false};
 assert.equal(cacheKey({},validSettings({...config,saveTranslation:true})),cacheKey({},validSettings({...config,saveTranslation:false})));
});
test('saves coalesce, never overlap, and keep changes arriving during a write',async()=>{
 let revision=0,saved=-1,active=0,maxActive=0,writes=0,release;
 const saver=new TranslationFileSaver({delay:10000,snapshot:()=>saved===revision?null:{doc:{},args:revision},write:async value=>{active++;maxActive=Math.max(maxActive,active);writes++;if(value===0)await new Promise(resolve=>release=resolve);active--;return value;},result:(_,value)=>saved=value,status:()=>{}});
 saver.request();saver.request();const flush=saver.flush();await new Promise(resolve=>setImmediate(resolve));revision=1;saver.request();release();await flush;
 assert.equal(saved,1);assert.equal(writes,2);assert.equal(maxActive,1);saver.cancelPending();
});
test('failed saves retain errors and can be retried; disabling cancels pending writes',async()=>{
 let failed=true,saved=false,error='';const saver=new TranslationFileSaver({delay:10000,snapshot:()=>({doc:{},args:{}}),write:async()=>{if(failed)throw Error('occupied');},result:()=>saved=true,status:(_,status,value)=>{if(status==='error')error=value;}});
 saver.request();await saver.flush();assert.equal(error,'occupied');assert.equal(saved,false);failed=false;saver.request();await saver.flush();assert.equal(saved,true);saved=false;saver.request();saver.cancelPending();await saver.flush();assert.equal(saved,false);
});
