const test = require('node:test');
const assert = require('node:assert/strict');
const { TranslationWorker } = require('../electron/translation-worker.cjs');
const responder = `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const job=JSON.parse(line);if(job.hang)return;console.log(JSON.stringify({id:job.id,type:'progress',progress:50}));console.log(JSON.stringify({id:job.id,type:job.fail?'error':'finish',error:'failed',pid:process.pid}));});`;
test('translation worker reuses a process and recovers after page errors and cancellation',async()=>{
  const worker=new TranslationWorker(()=>({exe:process.execPath,args:['-e',responder]}));
  try {
    let progress=0;
    const first=await worker.run({},process.cwd(),()=>progress++);
    const second=await worker.run({},process.cwd(),()=>{});
    assert.equal(first.pid,second.pid);assert.equal(progress,1);
    await assert.rejects(worker.run({fail:true},process.cwd(),()=>{}),/failed/);
    assert.equal((await worker.run({},process.cwd(),()=>{})).pid,first.pid);
    const pending=worker.run({hang:true},process.cwd(),()=>{});
    const rejection=assert.rejects(pending,/暂停/);worker.stop();await rejection;
    const restarted=await worker.run({},process.cwd(),()=>{});
    assert.notEqual(restarted.pid,first.pid);
  } finally { worker.stop(); }
});

test('page preemption acknowledges cancellation and reuses the warm worker',async()=>{
  const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-cancel-'));
  const responder=`const fs=require('node:fs');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const job=JSON.parse(line);console.log(JSON.stringify({id:job.id,type:'progress',progress:1,pid:process.pid}));if(!job.slow){console.log(JSON.stringify({id:job.id,type:'finish',pid:process.pid}));return;}const timer=setInterval(()=>{if(fs.existsSync(job.cancelFile)){clearInterval(timer);console.log(JSON.stringify({id:job.id,type:'cancelled'}));}},10);});`;
  const worker=new TranslationWorker(()=>({exe:process.execPath,args:['-e',responder]}));
  try{
    let started;const ready=new Promise(resolve=>started=resolve);
    const pending=worker.run({slow:true},directory,event=>started(event));
    const first=await ready;const rejected=assert.rejects(pending,error=>error.code==='TRANSLATION_CANCELLED');
    worker.cancel();worker.cancel();await rejected;
    const next=await worker.run({},directory,()=>{});
    assert.equal(first.pid,next.pid);
    assert.deepEqual(fs.readdirSync(path.join(directory,'translation-control')),[]);
  }finally{worker.stop();}
});

test('Windows stop waits for model descendants before application exit',{skip:process.platform!=='win32'},async()=>{
  const responder=`const {spawn}=require('node:child_process');require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const job=JSON.parse(line);const model=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});console.log(JSON.stringify({id:job.id,type:'finish',pid:process.pid,modelPid:model.pid}));});`;
  const worker=new TranslationWorker(()=>({exe:process.execPath,args:['-e',responder]}));
  const result=await worker.run({},process.cwd(),()=>{});
  const first=worker.stop();await worker.stop();await first;
  for(const pid of [result.pid,result.modelPid])assert.throws(()=>process.kill(pid,0));
});
