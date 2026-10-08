const { XMLParser } = require('fast-xml-parser');
const cache = new Map(); let arxivAt = 0;
const clean = value => String(value || '').replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim();
const escapeBib = value => String(value || '').replace(/[\\{}%&#_$]/g, c => ({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$'}[c]));
function bibtex(item) {
  const key = (item.authorList?.[0]?.family || item.authors?.split(/[ ,;]/)[0] || 'paper').replace(/[^\w]/g,'') + (item.year || '') + (item.title || '').replace(/[^a-z]/ig,'').slice(0,18);
  const authors = item.authorList?.map(a => [a.family,a.given].filter(Boolean).join(', ')).join(' and ') || item.authors?.split(';').map(s=>s.trim()).join(' and ');
  const fields = { title:item.title,author:authors,year:item.year,journal:item.journal,doi:item.doi,url:item.url,volume:item.volume,number:item.issue,pages:item.pagesText,abstract:item.abstract };
  return `@${item.type === 'book' ? 'book' : 'article'}{${key || 'paper'},\n${Object.entries(fields).filter(([,v])=>v).map(([k,v])=>`  ${k} = {${escapeBib(v)}}`).join(',\n')}\n}`;
}
function crossref(item) {
  const authors = (item.author || []).map(a => ({family:clean(a.family || a.name),given:clean(a.given)}));
  const result = { title:clean(item.title?.[0]), authors:authors.map(a=>[a.given,a.family].filter(Boolean).join(' ')).join('; '), authorList:authors, year:String((item.published || item.issued)?.['date-parts']?.[0]?.[0] || ''), doi:clean(item.DOI), abstract:clean(item.abstract), journal:clean(item['container-title']?.[0]), volume:clean(item.volume), issue:clean(item.issue), pagesText:clean(item.page), type:item.type, url:item.URL, provider:'Crossref' };
  result.bibtex=bibtex(result); return result;
}
async function get(url, accept='application/json') {
  if(cache.has(url))return cache.get(url);
  const response = await fetch(url, {headers:{Accept:accept,'User-Agent':'PDFSandwich/0.6 (https://github.com/ASOAT/PDFSandwich)'},signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw new Error(response.status===429?'元数据服务请求过多，请稍后重试。':`元数据服务暂不可用（${response.status}）。`);
  const text=await response.text();if(text.length>5_000_000)throw new Error('元数据响应过大。');cache.set(url,text);if(cache.size>100)cache.delete(cache.keys().next().value);return text;
}
async function lookup(query) {
  query=String(query || '').trim().slice(0,500); if(!query)throw new Error('请输入 DOI、arXiv ID 或文献标题。');
  const doi=query.replace(/^https?:\/\/(?:dx\.)?doi.org\//i,'');
  if(/^10\.\d{4,9}\//.test(doi))return [crossref(JSON.parse(await get('https://api.crossref.org/works/'+encodeURIComponent(doi))).message)];
  const arxiv=query.replace(/^(?:arxiv:\s*|https?:\/\/arxiv.org\/(?:abs|pdf)\/)/i,'').replace(/\.pdf$/i,'');
  if(/^(?:\d{4}\.\d{4,5}|[a-z-]+\/\d{7})(?:v\d+)?$/i.test(arxiv)) {
    const wait=Math.max(0,arxivAt+3100-Date.now());arxivAt=Date.now()+wait;if(wait)await new Promise(r=>setTimeout(r,wait));
    const xml=await get('https://export.arxiv.org/api/query?id_list='+encodeURIComponent(arxiv),'application/atom+xml');
    const parsed=new XMLParser({ignoreAttributes:false,removeNSPrefix:true}).parse(xml), entries=parsed.feed?.entry;
    return (Array.isArray(entries)?entries:entries?[entries]:[]).filter(e=>!String(e.id).includes('/errors')).map(e=>{
      const names=(Array.isArray(e.author)?e.author:[e.author]).filter(Boolean).map(a=>clean(a.name));
      const item={title:clean(e.title),authors:names.join('; '),year:String(e.published||'').slice(0,4),doi:clean(e.doi),abstract:clean(e.summary),url:clean(e.id),journal:'arXiv',provider:'arXiv'};return {...item,bibtex:bibtex(item)};
    });
  }
  const response=JSON.parse(await get('https://api.crossref.org/works?rows=5&query.bibliographic='+encodeURIComponent(query)));
  return response.message.items.map(crossref);
}
module.exports={lookup,bibtex,crossref};
