const test=require('node:test');
const assert=require('node:assert/strict');
const {FormulaRecognizer}=require('../electron/formula.cjs');
test('automatic recognition coalesces callers, serializes crops and retries failures',async()=>{
  let active=0,peak=0,calls=0;
  const service=new FormulaRecognizer(async({fail})=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;if(fail)throw Error('network');return {latex:'x'};});
  const first=service.recognize('a',{});
  assert.equal(service.recognize('a',{}),first);
  await Promise.all([first,service.recognize('b',{})]);assert.equal(peak,1);assert.equal(calls,2);
  await service.recognize('a',{});assert.equal(calls,2);
  await service.recognize('a',{},true);assert.equal(calls,3);
  await assert.rejects(service.recognize('c',{fail:true}),/network/);
  await service.recognize('c',{});assert.equal(calls,5);
});
