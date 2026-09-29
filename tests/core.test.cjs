const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, cacheKey, validSettings, readingPosition, PageQueue } = require('../electron/core.cjs');
test('range transport handles partial, suffix, clipped end and invalid ranges',()=>{
  assert.deepEqual(parseRange('bytes=10-19',100),{start:10,end:19,partial:true});
  assert.deepEqual(parseRange('bytes=-10',100),{start:90,end:99,partial:true});
  assert.deepEqual(parseRange('bytes=90-200',100),{start:90,end:99,partial:true});
  for(const v of ['bytes=100-','bytes=30-20','bytes=0-4,8-9','bytes=-','bytes=-0'])assert.equal(parseRange(v,100),null);
});
test('translation cache includes model and source revision without including secrets',()=>{
  const a={provider:'api',baseUrl:'https://api.deepseek.com',model:'a',apiKey:'one'};
  assert.equal(cacheKey('revision',a),cacheKey('revision',{...a,apiKey:'two'}));
  assert.notEqual(cacheKey('revision',a),cacheKey('revision',{...a,model:'b'}));
  assert.notEqual(cacheKey('revision',a),cacheKey('other',a));
  assert.notEqual(cacheKey('revision',a),cacheKey('revision',{...a,provider:'local'}));
  assert.equal(cacheKey('revision',{...a,provider:'local'}),cacheKey('revision',{...a,provider:'local',model:'unused-cloud-model'}));
});
test('provider settings permit localhost but reject remote plaintext credentials',()=>{
  assert.equal(validSettings({baseUrl:'http://localhost:11434/v1',model:'local'}).model,'local');
  assert.throws(()=>validSettings({baseUrl:'http://example.com',model:'x'}));
  assert.throws(()=>validSettings({baseUrl:'https://user:secret@example.com',model:'x'}));
  assert.throws(()=>validSettings({baseUrl:'https://example.com',model:''}));
});
test('reading position restores legacy drafts and bounds invalid values',()=>{
  assert.deepEqual(readingPosition({page:4},6),{page:4,fraction:0,zoom:1});
  assert.deepEqual(readingPosition({page:2,fraction:.42,zoom:1.5},6),{page:2,fraction:.42,zoom:1.5});
  assert.deepEqual(readingPosition({page:900,fraction:-5,zoom:9},6),{page:5,fraction:0,zoom:3});
  assert.deepEqual(readingPosition({page:NaN,fraction:Infinity,zoom:NaN},6),{page:0,fraction:0,zoom:1});
});
test('automatic translation follows reading without retaining abandoned neighbors',()=>{
  const queue=new PageQueue();
  queue.add([3,4,2],{automatic:true});
  assert.equal(queue.shift(),3);
  assert.deepEqual(queue.add([20,21,19],{automatic:true}),[4,2]);
  assert.equal(queue.length,3);
  assert.deepEqual([queue.shift(),queue.shift(),queue.shift()],[20,21,19]);
});
test('automatic priority preserves requested pages and whole-book work without duplicates',()=>{
  const queue=new PageQueue();
  queue.add([3,4,2,0,1,2,3,4,5]);
  assert.equal(queue.shift(),3);
  assert.deepEqual(queue.add([5,4],{automatic:true}),[]);
  assert.deepEqual([queue.shift(),queue.shift(),queue.shift(),queue.shift(),queue.shift()],[5,4,2,0,1]);
  queue.add([9],{automatic:true});queue.add([9]);queue.add([1,2],{automatic:true});
  assert.equal(queue.length,3);
  queue.clear();assert.equal(queue.length,0);assert.equal(queue.explicit.size,0);
});
