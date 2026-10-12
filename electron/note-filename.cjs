const path=require('node:path');
const {createHash}=require('node:crypto');

function cleanName(title) {
  let name=String(title||'Untitled').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'')||'Untitled';
  const stem=name.split('.')[0].trimEnd();
  if(name.startsWith('.')||/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(stem))name='_'+name;
  return name;
}

function noteFilename(directory,title,suffix='') {
  const name=cleanName(title),windows=process.platform==='win32';
  // Leave the full title alone whenever it fits. On Windows also stay inside
  // the traditional path limit for Vaults opened by other desktop tools.
  const measure=text=>windows?text.length:Buffer.byteLength(text,'utf8');
  const limit=windows?Math.min(255,259-path.resolve(directory).length-1):255;
  const available=limit-measure(suffix+'.md');
  if(measure(name)<=available)return name+suffix+'.md';
  const tail=' ~'+createHash('sha256').update(String(title)).digest('hex').slice(0,12);
  if(available<measure(tail)+1)throw new Error('笔记目录路径过长，请选择更短的存储目录或分类路径。');
  let prefix='';
  // Never split a surrogate pair, combining mark or emoji sequence.
  for(const {segment} of new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(name)){
    if(measure(prefix+segment+tail)>available)break;
    prefix+=segment;
  }
  return (prefix.replace(/[. ]+$/g,'')||'_')+tail+suffix+'.md';
}

module.exports={cleanName,noteFilename};
