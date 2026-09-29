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
