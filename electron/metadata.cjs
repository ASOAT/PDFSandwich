const { XMLParser, XMLValidator } = require('fast-xml-parser');
const clean = value => String(value || '').replace(/<[^>]+>/g, '').replace(/&(amp|lt|gt|quot|apos);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name])).replace(/\s+/g,' ').trim();
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
function normalizeDoi(value) {
  let doi=String(value||'').trim().replace(/^doi\s*:\s*/i,'').replace(/^https?:\/\/(?:dx\.)?doi.org\//i,'');
  try { doi=decodeURIComponent(doi); } catch {}
  doi=doi.replace(/[.,;]+$/,'');
  while(doi.endsWith(')')&&(doi.match(/\)/g)||[]).length>(doi.match(/\(/g)||[]).length)doi=doi.slice(0,-1);
  return /^10\.\d{4,9}\/\S+$/i.test(doi)?doi:'';
}
function datacite(record) {
  const a=record.attributes||{},authors=(a.creators||[]).map(c=>clean(c.name||[c.givenName,c.familyName].filter(Boolean).join(' ')));
  const item={title:clean(a.titles?.[0]?.title),authors:authors.join('; '),year:String(a.publicationYear||''),doi:clean(a.doi||record.id),abstract:clean(a.descriptions?.find(d=>d.descriptionType==='Abstract')?.description),journal:clean(a.container?.title||a.publisher),type:a.types?.resourceTypeGeneral?.toLowerCase(),url:a.url||`https://doi.org/${a.doi||record.id}`,provider:'DataCite'};
  return {...item,bibtex:bibtex(item)};
}
function openalex(a) {
  const words=[];
  for(const [word,positions] of Object.entries(a.abstract_inverted_index||{}))for(const pos of positions)if(Number.isInteger(pos)&&pos>=0&&pos<10000)words[pos]=word;
  const item={title:clean(a.title||a.display_name),authors:(a.authorships||[]).map(x=>clean(x.author?.display_name)).filter(Boolean).join('; '),year:String(a.publication_year||''),doi:normalizeDoi(a.doi),abstract:clean(words.join(' ')),journal:clean(a.primary_location?.source?.display_name),volume:clean(a.biblio?.volume),issue:clean(a.biblio?.issue),pagesText:[a.biblio?.first_page,a.biblio?.last_page].filter(Boolean).join('-'),type:a.type,url:a.doi||a.primary_location?.landing_page_url||a.id,provider:'OpenAlex'};
  return {...item,bibtex:bibtex(item)};
}
const normalized=value=>clean(value).normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
function titleSimilarity(a,b) {
  a=normalized(a);b=normalized(b);if(!a||!b)return 0;if(a===b)return 1;
  const tokens=s=>new Set(s.match(/[a-z0-9]+|[\p{L}\p{N}]/gu)||[]),left=tokens(a),right=tokens(b);
  const common=[...left].filter(word=>right.has(word)).length;
  return 2*common/(left.size+right.size);
}
function rank(items,titles) {
  const result=[];
  for(const item of items.filter(x=>x?.title)) {
    const doi=normalizeDoi(item.doi).toLowerCase(),existing=result.find(x=>doi&&normalizeDoi(x.doi).toLowerCase()===doi||(!doi||!x.doi)&&normalized(x.title)===normalized(item.title)&&x.year===item.year);
    if(existing) {
      if(!existing.authors&&item.authors){existing.authors=item.authors;existing.authorList=item.authorList;}
      for(const key of ['year','type','abstract','journal','doi','url','volume','issue','pagesText'])if(!existing[key]&&item[key])existing[key]=item[key];
      existing.bibtex=bibtex(existing);
    } else result.push({...item});
  }
  const score=item=>Math.max(0,...titles.map(title=>titleSimilarity(title,item.title)));
  return result.sort((a,b)=>score(b)-score(a)||(normalized(a.title)===normalized(b.title)&&a.year&&b.year?Number(a.year)-Number(b.year):0)).slice(0,12);
}
function createLookup({fetch:request=globalThis.fetch,timeout=12000}={}) {
  const cache=new Map();let arxivAt=0;
  async function get(url,accept='application/json') {
    const key=accept+' '+url,cached=cache.get(key);if(cached&&Date.now()-cached.at<15*60*1000)return cached.promise;
    const promise=(async()=>{
      const response=await request(url,{headers:{Accept:accept,'User-Agent':'PDFSandwich/0.6 (https://github.com/ASOAT/PDFSandwich)'},signal:AbortSignal.timeout(timeout)});
      if(response.status===404)return null;
      if(!response.ok)throw new Error(response.status===429?'元数据服务请求过多，请稍后重试。':`元数据服务暂不可用（${response.status}）。`);
      if(Number(response.headers.get('content-length'))>5_000_000)throw new Error('元数据响应过大。');
      const chunks=[];let size=0;
      for await(const chunk of response.body){size+=chunk.length;if(size>5_000_000)throw new Error('元数据响应过大。');chunks.push(Buffer.from(chunk));}
      return Buffer.concat(chunks).toString('utf8');
    })();
    cache.set(key,{at:Date.now(),promise});if(cache.size>100)cache.delete(cache.keys().next().value);
    try{return await promise;}catch(error){cache.delete(key);throw error;}
  }
  const json=async url=>{
    const text=await get(url);if(!text)return null;
    try {
      const value=JSON.parse(text),host=new URL(url).hostname;
      if(!value||typeof value!=='object'||(host==='api.crossref.org'&&!value.message)||(host==='api.datacite.org'&&!value.data)||(host==='api.openalex.org'&&!Array.isArray(value.results)))throw new Error('元数据响应不完整。');
      return value;
    } catch(error){cache.delete('application/json '+url);throw error;}
  };
  async function gather(tasks,errors) {
    const results=await Promise.allSettled(tasks);return results.flatMap(r=>{if(r.status==='fulfilled')return r.value||[];errors.push(r.reason);return [];});
  }
  async function byTitle(title,errors) {
    return gather([
      json('https://api.crossref.org/works?rows=8&query.bibliographic='+encodeURIComponent(title)).then(v=>(v?.message?.items||[]).map(crossref)),
      json('https://api.openalex.org/works?per_page=6&search.title='+encodeURIComponent(title)).then(v=>(v?.results||[]).map(openalex))
    ],errors);
  }
  async function lookup(query,{titles=[]}={}) {
    query=clean(query).slice(0,500);if(!query)throw new Error('请输入 DOI、arXiv ID 或文献标题。');
    titles=[...new Set((Array.isArray(titles)?titles:[]).filter(v=>typeof v==='string').map(v=>clean(v).slice(0,500)).filter(v=>v.length>=8))].slice(0,2);
    const errors=[];let items=[];
    const doi=normalizeDoi(query),arxiv=query.replace(/^(?:arxiv:\s*|https?:\/\/(?:www\.)?arxiv.org\/(?:abs|pdf)\/)/i,'').replace(/\.pdf$/i,'');
    if(doi) {
      items=await gather([
        json('https://api.crossref.org/works/'+encodeURIComponent(doi)).then(v=>v?.message?[crossref(v.message)]:[]),
        json('https://api.datacite.org/dois/'+encodeURIComponent(doi)).then(v=>v?.data?[datacite(v.data)]:[])
      ],errors);
    } else if(/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v\d+)?$/i.test(arxiv)) {
      const wait=Math.max(0,arxivAt+3100-Date.now());arxivAt=Date.now()+wait;if(wait)await new Promise(r=>setTimeout(r,wait));
      items=await gather([(async()=>{
        const url='https://export.arxiv.org/api/query?id_list='+encodeURIComponent(arxiv),xml=await get(url,'application/atom+xml');if(!xml)return [];
        let parsed;
        try{if(XMLValidator.validate(xml)!==true)throw new Error('元数据响应不完整。');parsed=new XMLParser({ignoreAttributes:false,removeNSPrefix:true}).parse(xml);if(!parsed.feed)throw new Error('元数据响应不完整。');}
        catch(error){cache.delete('application/atom+xml '+url);throw error;}
        const entries=parsed.feed.entry;
        return (Array.isArray(entries)?entries:entries?[entries]:[]).filter(e=>!String(e.id).includes('/errors')).map(e=>{
          const names=(Array.isArray(e.author)?e.author:[e.author]).filter(Boolean).map(a=>clean(a.name));
          const item={title:clean(e.title),authors:names.join('; '),year:String(e.published||'').slice(0,4),doi:clean(e.doi),abstract:clean(e.summary),url:clean(e.id),journal:'arXiv',provider:'arXiv'};return {...item,bibtex:bibtex(item)};
        });
      })()],errors);
    } else {items=await byTitle(query,errors);titles=[query,...titles.filter(v=>v!==query)].slice(0,2);}
    // Extracted identifiers can refer to a cited paper. Compare against the
    // visible title, but always leave the final choice to the user.
    if(titles.length&&(!items.length||Math.max(...items.map(i=>titleSimilarity(i.title,titles[0])))<.85)) {
      for(const title of titles.filter(v=>v!==query)) {
        items.push(...await byTitle(title,errors));
        if(items.some(i=>titleSimilarity(i.title,title)>=.85))break;
      }
    }
    if(!items.length&&errors.length)throw new Error('元数据检索暂不可用，请检查网络后重试，或换用完整标题。');
    return rank(items,titles.length?titles:[query]);
  }
  return lookup;
}
module.exports={lookup:createLookup(),createLookup,bibtex,crossref,datacite,openalex,normalizeDoi,titleSimilarity};
