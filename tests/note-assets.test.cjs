const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createResearch}=require('../electron/research.cjs');

test('Vault attachments and wiki paths resolve across note folders without leaving the selected Vault',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'pdfsandwich-assets-')),vault=path.join(root,'Vault'),profile=path.join(root,'profile');
  fs.mkdirSync(profile);fs.mkdirSync(path.join(vault,'Images'),{recursive:true});
  fs.writeFileSync(path.join(profile,'notes-settings.json'),JSON.stringify({mode:'obsidian',vault,notesFolder:'03Literature'}));
  const bytes=Buffer.from('89504e470d0a1a0a','hex');fs.writeFileSync(path.join(vault,'Images/chart.png'),bytes);fs.writeFileSync(path.join(root,'outside.png'),bytes);
  const research=createResearch({app:{isPackaged:false},root,userDir:()=>profile,getWindow:()=>null});
  t.after(()=>{research.dispose();fs.rmSync(root,{recursive:true,force:true});});
  const note=research.actions.notesCreate({title:'Paper'});
  for(const relative of ['../Images/chart.png','Images/chart.png','chart.png']){
    const url=research.actions.notesAsset({id:note.id,relative});assert.ok(url.startsWith('pdfsandwich://asset/'));
  }
  assert.throws(()=>research.actions.notesAsset({id:note.id,relative:'../../outside.png'}));
  assert.equal(research.actions.notesWiki({id:note.id,name:'03Literature/Paper'}).id,note.id);
  assert.equal(research.actions.notesWiki({id:note.id,name:'Paper.md#Finding'}).id,note.id);
});
