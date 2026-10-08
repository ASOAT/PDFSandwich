const fs=require('node:fs');
const path=require('node:path');

function renderTemplate(text,document={},now=new Date(),formats={}) {
  const pad=value=>String(value).padStart(2,'0');
  const tokens={YYYY:String(now.getFullYear()),MM:pad(now.getMonth()+1),DD:pad(now.getDate()),HH:pad(now.getHours()),mm:pad(now.getMinutes()),ss:pad(now.getSeconds())};
  const format=value=>value.replace(/\[[^\]]*\]|YYYY|MM|DD|HH|mm|ss/g,token=>token.startsWith('[')?token.slice(1,-1):tokens[token]);
  const fields={title:document.title||'',authors:document.authors||'',year:document.year||'',doi:document.doi||'',abstract:document.abstract||'',url:document.url||''};
  return text.replace(/\{\{\s*(title|authors|year|doi|abstract|url|date|time)(?::([^{}]+))?\s*\}\}/g,(match,key,custom)=>{
    if(key==='date'||key==='time')return format(custom?.trim()||formats[key+'Format']||(key==='date'?'YYYY-MM-DD':'HH:mm'));
    return fields[key];
  });
}
function templateContent(config,document,validate) {
  if(config.mode!=='obsidian'||!config.templateFile)return '';
  const file=validate(config.vault,config.templateFile);
  if(path.extname(file).toLowerCase()!=='.md'||!fs.existsSync(file)||!fs.statSync(file).isFile())throw new Error('所选笔记模板不存在，请在 Obsidian 的 PDFSandwich 设置中重新选择或清除模板。');
  if(fs.statSync(file).size>5*1024*1024)throw new Error('模板超过 5 MB。');
  const settingsFile=path.join(config.vault,'.obsidian','templates.json');
  const formats=fs.existsSync(settingsFile)?JSON.parse(fs.readFileSync(settingsFile,'utf8')):{};
  return renderTemplate(fs.readFileSync(file,'utf8'),document,undefined,formats);
}
module.exports={renderTemplate,templateContent};
