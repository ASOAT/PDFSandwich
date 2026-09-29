const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRange, cacheKey, validSettings } = require('../electron/core.cjs');
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
