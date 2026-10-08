const fs=require('node:fs');
const path=require('node:path');
const clean=value=>String(value??'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'').trim().replace(/[. ]+$/,'').slice(0,140);
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function dateText(pattern,now){
  const pad=(n,width=2)=>String(n).padStart(width,'0');
  const values={YYYY:now.getFullYear(),YY:pad(now.getFullYear()%100),MM:pad(now.getMonth()+1),M:now.getMonth()+1,DD:pad(now.getDate()),D:now.getDate(),HH:pad(now.getHours()),H:now.getHours(),mm:pad(now.getMinutes()),m:now.getMinutes(),ss:pad(now.getSeconds()),s:now.getSeconds(),SSS:pad(now.getMilliseconds(),3)};
  return pattern.replace(/\[[^\]]*\]|YYYY|SSS|YY|MM|DD|HH|mm|ss|M|D|H|m|s/g,token=>token[0]==='['?token.slice(1,-1):String(values[token]));
}
function naming(config,note,meta,now=new Date()){
  const enabled=config.mode==='obsidian'&&(read(path.join(config.vault,'.obsidian/community-plugins.json'))||[]).includes('obsidian-paste-image-rename');
  if(!enabled)return {stem:'Image '+dateText('YYYYMMDDHHmmss',now),delimiter:'-',always:false,prefix:false};
  const settings=read(path.join(config.vault,'.obsidian/plugins/obsidian-paste-image-rename/data.json'))||{};
  const vars={fileName:path.basename(note.relative,'.md'),dirName:path.basename(path.dirname(path.join(config.vault,config.notesFolder,note.relative))),imageNameKey:meta.imageNameKey||'',firstHeading:/^#{1,6}\s+(.+)$/m.exec(note.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,''))?.[1]||''};
  const rendered=String(settings.imageNamePattern||'{{fileName}}').replace(/{{DATE:([^}]+)}}/g,(_,format)=>dateText(format,now)).replace(/{{frontmatter:([^}]+)}}/g,(_,key)=>String(meta[key]??'')).replace(/{{(fileName|dirName|imageNameKey|firstHeading)}}/g,(_,key)=>vars[key]);
  const stem=clean(rendered)||'Image '+dateText('YYYYMMDDHHmmss',now);
  return {stem:/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(stem)?'Image-'+stem:stem,delimiter:clean(settings.dupNumberDelimiter??'-')||'-',always:settings.dupNumberAlways===true,prefix:settings.dupNumberAtStart===true};
}
function writeImage(directory,bytes,rule){
  fs.mkdirSync(directory,{recursive:true});
  const pattern=new RegExp('^'+(rule.prefix?'(\\d+)'+escape(rule.delimiter)+escape(rule.stem):escape(rule.stem)+escape(rule.delimiter)+'(\\d+)')+'\\.png$','i');
  const files=fs.readdirSync(directory),hasBase=files.some(name=>name.toLowerCase()===(rule.stem+'.png').toLowerCase());
  let number=hasBase||rule.always?Math.max(0,...files.map(name=>Number(pattern.exec(name)?.[1])||0))+1:0;
  for(let attempt=0;attempt<1000;attempt++){
    const stem=number?(rule.prefix?number+rule.delimiter+rule.stem:rule.stem+rule.delimiter+number):rule.stem;
    const file=path.join(directory,stem+'.png');
    try{fs.writeFileSync(file,bytes,{flag:'wx'});return file;}catch(error){if(error.code!=='EEXIST')throw error;number++;}
  }
  throw new Error('图片文件重名过多，请更换命名规则。');
}
module.exports={naming,writeImage,dateText};
