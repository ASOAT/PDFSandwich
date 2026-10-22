import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';

const root=process.cwd(),require=createRequire(import.meta.url);
const version=require('../package.json').version;
const exe=path.resolve(process.env.PDFSANDWICH_TEST_EXE||`release/${version}/win-unpacked/PDFSandwich.exe`);
const program=path.dirname(exe),blocked=path.join(program,'Library');
assert.ok(program.toLowerCase().startsWith(path.join(root,'release').toLowerCase()+path.sep),'Use a generated workspace checkout only');
const exists=file=>fs.access(file).then(()=>true,()=>false);
assert.equal(await exists(blocked),false,'Never change permissions of an existing Library');
const profile=await fs.mkdtemp(path.join(root,'local-data','permissions-'));
execFileSync(path.join(root,'.venv/Scripts/python.exe'),['scripts/library-fixture.py',path.join(profile,'originals')]);
const original=path.join(profile,'originals','example-1.pdf'),bytes=await fs.readFile(original);
const oldId='preserved-document',oldPath=path.join(blocked,oldId,'old.pdf');
await fs.mkdir(path.dirname(oldPath),{recursive:true});await fs.copyFile(original,oldPath);
const {Library}=require('../electron/library.cjs');
const library=new Library(path.join(profile,'library.json'),blocked);
const old=library.upsert({path:oldPath,title:'Existing paper',pages:1,size:bytes.length});
old.id=oldId;old.managed=true;old.originalPath=original;library.save();
await fs.writeFile(path.join(profile,'settings.json'),JSON.stringify({autoTranslate:false,provider:'local'}));
await fs.writeFile(path.join(profile,'updates.json'),JSON.stringify({autoCheck:false}));
function acl(deny){
  const script="$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; "+
    // Deny only write operations. Generic W also includes SYNCHRONIZE, which
    // would accidentally deny ordinary PDF reads in some native libraries.
    (deny?"& icacls.exe $env:PDFSANDWICH_TEST_LIBRARY /deny ('*'+$sid+':(OI)(CI)(WD,AD,WEA,WA)') | Out-Null; ":"& icacls.exe $env:PDFSANDWICH_TEST_LIBRARY /remove:d ('*'+$sid) | Out-Null; ")+
    "if($LASTEXITCODE -ne 0){throw 'Test directory ACL update failed'}";
  execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,PDFSANDWICH_TEST_LIBRARY:blocked},windowsHide:true});
}
let app;
const errors=[];
try {
  acl(true);
  await assert.rejects(fs.mkdir(path.join(blocked,'permission-check')),error=>['EPERM','EACCES'].includes(error.code));
  assert.deepEqual(await fs.readFile(oldPath),bytes,'Write restriction must still allow reading old documents');
  app=await electron.launch({executablePath:exe,cwd:root,env:{...process.env,PDFSANDWICH_DATA_DIR:profile},timeout:60000});
  let page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));
  const call=(action,args)=>page.evaluate(({action,args})=>window.pdfsandwich.call(action,args),{action,args});
  await page.getByRole('heading',{name:'全部文献'}).waitFor();
  let state=await call('libraryState');assert.equal(state.storageRoot,path.join(profile,'Library'));
  assert.equal(state.documents[0].path,oldPath);assert.equal(state.documents[0].missing,false);
  await call('libraryOpen',{id:oldId});assert.equal((await call('state')).doc.path,oldPath);
  const imported=await call('libraryImport',{paths:[original]});assert.deepEqual(imported.errors,[]);
  // Use a different source for a new document, preserving the old association.
  const fresh=await call('libraryImport',{paths:[path.join(profile,'originals','example-2.pdf')]});
  assert.deepEqual(fresh.errors,[]);const item=fresh.library.documents.find(d=>d.id===fresh.imported[0]);
  assert.equal(path.dirname(path.dirname(item.path)),path.join(profile,'Library'));
  await call('libraryOpen',{id:item.id});await page.getByRole('textbox',{name:'当前页码'}).waitFor();
  await call('notesForDocument',{documentId:item.id});
  await page.getByRole('button',{name:'文献库',exact:true}).click();
  await page.getByRole('button',{name:'文献库存储位置',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'文献库存储位置'});await modal.waitFor();
  assert.match(await modal.textContent(),/写入权限/);assert.equal(await modal.getByRole('button',{name:'选择位置'}).isEnabled(),true);
  await fs.mkdir(path.join(root,'test-results'),{recursive:true});await page.screenshot({path:path.join(root,'test-results','storage-permissions.png')});
  await app.evaluate(({app})=>app.exit(0));app=null;
  const persisted=new Library(path.join(profile,'library.json'));assert.equal(persisted.data.storageRoot,path.join(profile,'Library'));
  assert.equal(persisted.get(oldId).path,oldPath);assert.deepEqual(await fs.readFile(oldPath),bytes);assert.deepEqual(await fs.readFile(original),bytes);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({packaged:true,realWindowsPermissionDenial:true,fallbackPersisted:true,existingPdfPreserved:true,importAndRead:true,notes:true,storageDialog:true,errors}));
} finally {
  if(app)await app.evaluate(({app})=>app.exit(0)).catch(()=>{});
  acl(false);
  assert.equal(path.dirname(blocked),program);assert.ok(blocked.startsWith(path.join(root,'release')+path.sep));
  await fs.rm(blocked,{recursive:true,force:true});
}
