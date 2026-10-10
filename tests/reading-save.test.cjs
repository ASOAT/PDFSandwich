const {test}=require('node:test');
const assert=require('node:assert/strict');
const {ReadingSave}=require('../electron/reading-save.cjs');
const {readingWindow}=require('../electron/core.cjs');
test('scroll saves coalesce, bound continuous reading, and flush before document changes',()=>{
  let time=0,id=0,writes=0;const tasks=new Map();
  const timers={setTimeout:(fn,delay)=>{tasks.set(++id,{at:time+delay,fn});return id;},clearTimeout:id=>tasks.delete(id)};
  function advance(ms) { const end=time+ms;for(;;){const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;time=next[1].at;tasks.delete(next[0]);next[1].fn();}time=end; }
  const saver=new ReadingSave(()=>writes++,{timers});
  for(let i=0;i<100;i++){saver.request();advance(10);}
  assert.equal(writes,0);advance(500);assert.equal(writes,1);
  for(let i=0;i<500;i++){saver.request();advance(10);}
  assert.equal(writes,3);saver.flush();assert.equal(writes,4);advance(3000);assert.equal(writes,4);
  saver.request();saver.cancel();advance(3000);assert.equal(writes,4);
});
test('prefetch follows reading direction, prioritizes jumps, and stays in bounds',()=>{
  assert.deepEqual(readingWindow(50,2,100),[50,51,52,53,49]);
  assert.deepEqual(readingWindow(50,70,100),[50,49,48,47,51]);
  assert.deepEqual(readingWindow(0,1,100),[0,1]);
  assert.deepEqual(readingWindow(99,98,100),[99,98]);
});
