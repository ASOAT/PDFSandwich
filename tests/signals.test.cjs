const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {createSignalStore,fresh,validate}=require('../electron/signals.cjs');
const noImages={createFromBuffer(){throw new Error('Unexpected image decoding');}};
test('custom directions survive restarting the store, with independent defaults',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-signals-'));
  try{
    const file=path.join(root,'prefs','signals.json'),store=createSignalStore(file,noImages);
    const initial=store.get();initial.slots[0]={kind:'emoji',value:'🫠',label:'融化了',color:'#bbaa66'};
    assert.equal(fresh().slots[0].value,'question');
    const saved=store.save(initial);assert.deepEqual(createSignalStore(file,noImages).get(),saved);
    assert.deepEqual(fs.readdirSync(path.dirname(file)),['signals.json']);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('invalid edits never overwrite a valid wheel',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-signals-'));
  try{
    const file=path.join(root,'signals.json'),store=createSignalStore(file,noImages);store.save(fresh());const before=fs.readFileSync(file);
    for(const patch of [{kind:'unknown'},{value:'missing'},{label:''},{label:'x'.repeat(17)},{color:'url(https://example.com)'},{kind:'emoji',value:'<script>'},{kind:'emoji',value:'🙂🙂'}]){
      const bad=fresh();Object.assign(bad.slots[0],patch);assert.throws(()=>store.save(bad));assert.deepEqual(fs.readFileSync(file),before);
    }
    assert.throws(()=>store.save({version:1,slots:[]}));assert.throws(()=>store.save({...fresh(),version:2}));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('stored corruption is reported and retained until explicit replacement',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-signals-'));
  try{const file=path.join(root,'signals.json');fs.writeFileSync(file,'broken config');assert.throws(()=>createSignalStore(file,noImages).get());assert.equal(fs.readFileSync(file,'utf8'),'broken config');}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('image input rejects remote URLs, SVG, oversized bytes and oversized decoded dimensions',()=>{
  const header=Buffer.alloc(33);Buffer.from('89504e470d0a1a0a','hex').copy(header);header.write('IHDR',12);header.writeUInt32BE(999999,16);header.writeUInt32BE(256,20);
  for(const value of ['https://example.com/x.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,'+'a'.repeat(360000),'data:image/png;base64,'+header.toString('base64')]){
    const bad=fresh();bad.slots[0]={...bad.slots[0],kind:'image',value};assert.throws(()=>validate(bad,noImages));
  }
  header.writeUInt32BE(256,16);const bad=fresh();bad.slots[0]={...bad.slots[0],kind:'image',value:'data:image/png;base64,'+header.toString('base64')};
  assert.throws(()=>validate(bad,{createFromBuffer:()=>({isEmpty:()=>true})}),/无法读取/);
});
test('failed atomic replacement cleans only its temporary file',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-signals-'));
  try{const target=path.join(root,'occupied');fs.mkdirSync(target);assert.throws(()=>createSignalStore(target,noImages).save(fresh()));assert.deepEqual(fs.readdirSync(root),['occupied']);}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});
