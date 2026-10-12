const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createLookup,normalizeDoi,titleSimilarity}=require('../electron/metadata.cjs');
const reply=(value,status=200)=>new Response(typeof value==='string'?value:JSON.stringify(value),{status});
const paper={title:['Deep Residual Learning for Image Recognition'],author:[{given:'Kaiming',family:'He'}],published:{'date-parts':[[2016]]},DOI:'10.1109/CVPR.2016.90','container-title':['CVPR'],type:'proceedings-article'};
const alex={title:paper.title[0],doi:'https://doi.org/'+paper.DOI,publication_year:2016,authorships:[{author:{display_name:'Kaiming He'}}],primary_location:{source:{display_name:'CVPR'}},abstract_inverted_index:{Deep:[0],networks:[1]}};

test('DOI labels and URLs preserve meaningful closing parentheses',()=>{
  assert.equal(normalizeDoi('DOI: 10.1109/CVPR.2016.90.'),paper.DOI);
  assert.equal(normalizeDoi('https://doi.org/10.1000%2Ffoo(2026).'), '10.1000/foo(2026)');
  assert.equal(normalizeDoi('10.1000/foo(2026))'),'10.1000/foo(2026)');
  assert.equal(normalizeDoi('A study of networks'),'');
  assert.equal(titleSimilarity('DÉEP residual learning: for image recognition',paper.title[0]),1);
  assert.ok(titleSimilarity('中文文献管理','中文文献管理系统')>titleSimilarity('中文文献管理','其他主题'));
});
test('title lookup ranks matching papers ahead of broad matches and merges duplicate DOI metadata',async()=>{
  const calls=[];const lookup=createLookup({fetch:async url=>{calls.push(url);return reply(url.includes('crossref')?{message:{items:[{...paper,title:['Deep learning survey'],DOI:'10.1/wrong'},paper]}}:{results:[alex]});}});
  const result=await lookup(paper.title[0]);
  assert.equal(result[0].title,paper.title[0]);assert.equal(result[0].abstract,'Deep networks');
  assert.equal(result.filter(r=>r.doi===paper.DOI).length,1);assert.match(result[0].bibtex,/Kaiming/);
  assert.ok(calls.some(url=>url.includes('search.title=')));
  await lookup(paper.title[0]);assert.equal(calls.length,2);
});
test('a failing provider does not discard results from another provider',async()=>{
  const lookup=createLookup({fetch:async url=>url.includes('crossref')?reply('rate limited',429):reply({results:[alex]})});
  assert.equal((await lookup(paper.title[0]))[0].provider,'OpenAlex');
});
test('DataCite DOI metadata is available even when Crossref has no record',async()=>{
  const lookup=createLookup({fetch:async url=>url.includes('crossref')?reply('missing',404):reply({data:{id:'10.1234/example',attributes:{titles:[{title:'A repository paper'}],creators:[{name:'Ada Lovelace'}],publicationYear:2025,descriptions:[{descriptionType:'Abstract',description:'A study'}]}}})});
  const [item]=await lookup('doi:10.1234/example');assert.equal(item.provider,'DataCite');assert.equal(item.title,'A repository paper');assert.equal(item.authors,'Ada Lovelace');assert.match(item.bibtex,/A study/);
});
test('missing identifiers fall back to extracted title instead of ending the search',async()=>{
  const lookup=createLookup({fetch:async url=>{
    if(url.includes('/works/10.')||url.includes('datacite'))return reply('missing',404);
    return reply(url.includes('crossref')?{message:{items:[paper]}}:{results:[]});
  }});
  const [item]=await lookup('10.1234/missing',{titles:[paper.title[0]]});assert.equal(item.doi,paper.DOI);
});
test('an extracted reference DOI cannot outrank the visible paper title',async()=>{
  const wrong={...paper,title:['A different cited paper'],DOI:'10.1234/citation'};
  const lookup=createLookup({fetch:async url=>{
    if(url.includes('datacite'))return reply('missing',404);
    if(url.includes('/works/10.'))return reply({message:wrong});
    return reply(url.includes('crossref')?{message:{items:[paper]}}:{results:[]});
  }});
  const result=await lookup(wrong.DOI,{titles:[paper.title[0]]});assert.equal(result[0].doi,paper.DOI);assert.ok(result.some(p=>p.doi===wrong.DOI));
});
test('explicit DOI lookup retains the exact record without guessing another title',async()=>{
  const lookup=createLookup({fetch:async url=>url.includes('crossref')?reply({message:paper}):reply('missing',404)});
  assert.equal((await lookup(paper.DOI))[0].doi,paper.DOI);
});
test('arXiv still handles Atom records and legacy subject IDs',async()=>{
  const lookup=createLookup({fetch:async url=>{assert.ok(url.includes('export.arxiv.org'));return reply('<feed><entry><id>https://arxiv.org/abs/math.DG/0309136</id><title>A paper title</title><author><name>Author One</name></author><published>2003-09-01</published><summary>Study</summary></entry></feed>');}});
  const [item]=await lookup('arXiv:math.DG/0309136');assert.equal(item.provider,'arXiv');assert.equal(item.authors,'Author One');assert.equal(item.year,'2003');
});
test('provider failures are retryable and never cached as an empty success',async()=>{
  let fail=true,calls=0;const lookup=createLookup({fetch:async()=>{calls++;if(fail)throw new Error('offline');return reply({results:[alex],message:{items:[paper]}});}});
  await assert.rejects(lookup(paper.title[0]),/网络/);fail=false;assert.equal((await lookup(paper.title[0]))[0].title,paper.title[0]);assert.equal(calls,4);
});
test('oversized responses are rejected while an independent source remains usable',async()=>{
  const lookup=createLookup({fetch:async url=>url.includes('crossref')?new Response('x',{headers:{'content-length':'6000000'}}):reply({results:[alex]})});
  assert.equal((await lookup(paper.title[0]))[0].provider,'OpenAlex');
});
test('malformed successful responses are discarded so a retry can recover',async()=>{
  let broken=true,crossrefCalls=0;const lookup=createLookup({fetch:async url=>{
    if(url.includes('openalex'))return reply({results:[]});
    crossrefCalls++;return reply(broken?'<html>Temporary proxy error</html>':{message:{items:[paper]}});
  }});
  await assert.rejects(lookup(paper.title[0]),/网络/);broken=false;
  assert.equal((await lookup(paper.title[0]))[0].doi,paper.DOI);assert.equal(crossrefCalls,2);
});
test('duplicate DOI records fill absent author and year fields before generating BibTeX',async()=>{
  const lookup=createLookup({fetch:async url=>reply(url.includes('crossref')?{message:{items:[{title:paper.title,DOI:paper.DOI}]}}:{results:[alex]})});
  const [result]=await lookup(paper.title[0]);assert.equal(result.authors,'Kaiming He');assert.equal(result.year,'2016');assert.match(result.bibtex,/author = \{Kaiming He\}/);assert.match(result.bibtex,/year = \{2016\}/);
});
