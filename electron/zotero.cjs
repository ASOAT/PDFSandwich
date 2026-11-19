// Zotero owns its database and attachments. This adapter only reads its local API.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const KEY = /^[A-Z0-9]{8}$/;
function libraryPath(value = 'users/0') {
  if (typeof value !== 'string' || !/^(users\/0|groups\/[1-9]\d*)$/.test(value)) throw new Error('无效 Zotero 文库。');
  return value;
}
function reference(value) {
  const library = libraryPath(value?.library);
  if (typeof value?.key !== 'string' || !KEY.test(value.key)) throw new Error('无效 Zotero 附件标识。');
  if (value.serverId !== undefined && (typeof value.serverId !== 'string' || !/^[\w-]{1,128}$/.test(value.serverId))) throw new Error('无效 Zotero 实例。');
  return {library, key:value.key, ...(value.serverId ? {serverId:value.serverId} : {})};
}
function noteDocumentId(value) {
  const ref=reference(value);
  return `zotero-${ref.library.replace('/','-')}-${ref.key}${ref.serverId?'-'+ref.serverId:''}`;
}
function fromNoteDocumentId(id) {
  const match=/^zotero-(users-0|groups-[1-9]\d*)-([A-Z0-9]{8})(?:-([\w-]{1,128}))?$/.exec(id);
  return match ? reference({library:match[1].replace('-','/'),key:match[2],serverId:match[3]}) : null;
}
function parseLink(link) {
  const url = new URL(link), parts = url.pathname.slice(1).split('/');
  if (url.protocol !== 'pdfsandwich:' || url.hostname !== 'zotero' || url.username || url.password || url.port || parts.length !== 3 || url.hash) throw new Error('无效 Zotero 文献链接。');
  const ref = reference({library:parts.slice(0,2).join('/'),key:parts[2],serverId:url.searchParams.get('server') || undefined});
  if (!url.searchParams.has('page')) return ref;
  const page = Number(url.searchParams.get('page'));
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new Error('无效链接页码。');
  return {...ref,page:page-1};
}
function requestLocal(route, {port=23119, serverId} = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({hostname:'127.0.0.1',port,path:`/api/${route}`,headers:{'Zotero-API-Version':'3',...(serverId?{'Zotero-Server-ID':serverId}:{})}}, res => {
      const chunks=[];let size=0;
      res.on('data', chunk => {size+=chunk.length;if(size>24*1024*1024)req.destroy(new Error('Zotero 响应过大，请缩小查询范围。'));else chunks.push(chunk);});
      res.on('error',reject);
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
    });
    const timer=setTimeout(()=>req.destroy(new Error('Zotero 响应超时，请确认它已启动。')),20000);
    req.once('close',()=>clearTimeout(timer));req.on('error',reject);
  });
}
const isPDF = item => item?.data?.itemType === 'attachment' && item.data.contentType === 'application/pdf' && item.data.linkMode !== 'linked_url';
function describe(attachment,parent) {
  const data=parent?.data || attachment.data, own=attachment.data;
  return {key:attachment.key,title:data.title||own.filename||'未命名 PDF',filename:own.filename||own.title||'',
    authors:(data.creators||[]).map(c=>c.name||[c.firstName,c.lastName].filter(Boolean).join(' ')).join(', '),
    year:(data.date||'').match(/\b(?:18|19|20)\d{2}\b/)?.[0]||'',
    collections:[...new Set([...(data.collections||[]),...(own.collections||[])])],
    tags:[...new Set([...(data.tags||[]),...(own.tags||[])].map(t=>t.tag).filter(Boolean))],
    doi:data.DOI||'',abstract:data.abstractNote||'',journal:data.publicationTitle||'',url:data.url||''};
}
class ZoteroClient {
  constructor({request=requestLocal}={}) {this.request=request;}
  async read(route,serverId,allowRedirect=false) {
    let response;
    try {response=await this.request(route,{serverId});}
    catch(error) {throw new Error(`无法连接 Zotero，请先启动 Zotero。${error.code==='ECONNREFUSED'?'':error.message}`);}
    const {status}=response;
    if(status===403)throw new Error('请在 Zotero 设置 → 高级中开启“允许此计算机上的其他应用程序与 Zotero 通信”。');
    if(status===412)throw new Error('Zotero 已切换文库实例，请刷新列表后重新打开。');
    if(status===404)throw Object.assign(new Error('Zotero 中找不到此条目或附件，请刷新文库，并确认 PDF 已在 Zotero 中下载。'),{status});
    if(status>=300&&!(allowRedirect&&status===302))throw new Error(`Zotero 返回 ${status}，请确认附件已下载，必要时更新 Zotero。`);
    return response;
  }
  async json(route,serverId) {
    const response=await this.read(route,serverId);
    try {return {data:JSON.parse(response.text),serverId:response.headers['zotero-server-id']||serverId};}
    catch {throw new Error('Zotero 返回了无法读取的数据。');}
  }
  async list(route,serverId) {
    const result=[],seen=new Set();
    for(let start=0;start<1000000;start+=100){
      const response=await this.json(`${route}${route.includes('?')?'&':'?'}limit=100&start=${start}`,serverId);
      serverId=response.serverId;
      if(!Array.isArray(response.data))throw new Error('Zotero 列表格式无效。');
      let added=0;
      for(const item of response.data){const key=item.key??item.id;if(!seen.has(key)){seen.add(key);result.push(item);added++;}}
      if(response.data.length<100)return {data:result,serverId};
      if(!added)throw new Error('Zotero 分页未前进，请刷新后重试。');
    }
    throw new Error('Zotero 文库过大，请按分类读取。');
  }
  async libraries() {
    const {data,serverId}=await this.list('users/0/groups');
    return {serverId,libraries:[{id:'users/0',name:'我的文库'},...data.map(g=>({id:`groups/${g.id}`,name:g.data?.name||g.name||`群组 ${g.id}`}))]};
  }
  async snapshot(value) {
    const library=libraryPath(value.library);
    const attachments=await this.list(`${library}/items?itemType=attachment`,value.serverId);
    const serverId=attachments.serverId;
    const pdfs=attachments.data.filter(isPDF),keys=[...new Set(pdfs.map(a=>a.data.parentItem).filter(k=>KEY.test(k)))],parents=new Map();
    const {data:collections}=await this.list(`${library}/collections`,serverId);
    for(let i=0;i<keys.length;i+=50){const {data}=await this.json(`${library}/items/top?itemKey=${keys.slice(i,i+50).join(',')}`,serverId);if(!Array.isArray(data))throw new Error('Zotero 元数据格式无效。');for(const p of data)parents.set(p.key,p);}
    return {library,serverId,collections:collections.map(c=>({id:c.key,name:c.data.name,parentId:c.data.parentCollection||null})),documents:pdfs.map(a=>describe(a,parents.get(a.data.parentItem)))};
  }
  async resolve(value) {
    const ref=reference(value),base=`${ref.library}/items/${ref.key}`;
    const {data:attachment,serverId}=await this.json(base,ref.serverId);
    if(!isPDF(attachment))throw new Error('所选条目不是本地 PDF 附件，请选择论文下的 PDF。');
    let response;
    try {response=await this.read(`${base}/file/view/url`,serverId);}
    catch(error){if(error.status!==404)throw error;response=await this.read(`${base}/file`,serverId,true);}
    let url;
    try {url=new URL(response.status===302?response.headers.location:response.text.trim());}
    catch {throw new Error('Zotero 未提供本地 PDF 路径，请先下载附件。');}
    if(url.protocol!=='file:'||url.search||url.hash)throw new Error('Zotero 未提供本地 PDF 路径，请先下载附件。');
    const file=fileURLToPath(url);
    if(!path.isAbsolute(file)||path.extname(file).toLowerCase()!=='.pdf')throw new Error('Zotero 附件路径不是 PDF。');
    try{if(!(await fs.stat(file)).isFile())throw new Error();}catch{throw new Error('PDF 尚未下载或已移动，请先在 Zotero 中打开并下载附件，再重试。');}
    let parent=null;
    if(KEY.test(attachment.data.parentItem||'')){
      try {parent=(await this.json(`${ref.library}/items/${attachment.data.parentItem}`,serverId)).data;}
      catch(error){if(error.status!==404)throw error;}
    }
    return {path:file,reference:{...ref,...(serverId?{serverId}:{})},metadata:describe(attachment,parent)};
  }
}
module.exports={ZoteroClient,requestLocal,reference,noteDocumentId,fromNoteDocumentId,parseLink};
