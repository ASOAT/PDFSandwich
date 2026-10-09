const crypto = require('node:crypto');
function cacheKey(stamp, settings) {
  return crypto.createHash('sha256').update(JSON.stringify({ stamp, provider: settings.provider || 'local', base: settings.provider === 'api' ? settings.baseUrl : '', model: settings.provider === 'api' ? settings.model : settings.localEngine || 'hy', glossary: settings.glossary || '', useGlossary: settings.useGlossary !== false, engine: 'pdf2zh-next-2.9.0', from: 'en', to: 'zh', version: 6 })).digest('hex').slice(0, 24);
}
function parseRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = !match[1];
  const start = suffix ? Math.max(0, size - Number(match[2])) : Number(match[1]);
  const end = suffix || !match[2] ? size - 1 : Math.min(size - 1, Number(match[2]));
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return null;
  return { start, end, partial: true };
}
function validSettings(value) {
  const url = new URL(value.baseUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('云端服务地址需要 HTTPS；本地服务可以使用 HTTP。');
  if (url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含密码、查询参数或片段。');
  if (typeof value.model !== 'string' || !value.model.trim()) throw new Error('请输入模型名称。');
  if (value.provider && !['local','api'].includes(value.provider)) throw new Error('未知翻译方式。');
  if (value.localEngine && !['hy','argos'].includes(value.localEngine)) throw new Error('未知本地翻译引擎。');
  const glossary = String(value.glossary || '').trim();
  if (glossary.length > 20000 || glossary.split('\n').length > 200) throw new Error('自定义术语最多 200 行、20,000 字符。');
  if (glossary.split('\n').filter(line => line.trim()).some(line => { const split = line.indexOf('='); return split < 1 || [line.slice(0,split).trim(),line.slice(split+1).trim()].some(part => !part || part.length>120); })) throw new Error('术语表请按每行“英文 = 中文”填写，原文和译文各不超过 120 个字符。');
  return { provider: value.provider || 'local', localEngine: value.localEngine || 'hy', useGlossary: value.useGlossary !== false, glossary, baseUrl: url.href.replace(/\/$/, '').replace(/\/chat\/completions$/, ''), model: value.model.trim(), autoTranslate: Boolean(value.autoTranslate), saveTranslation: Boolean(value.saveTranslation) };
}
function readingPosition(value, pageCount) {
  return {
    page: Number.isInteger(value?.page) ? Math.max(0, Math.min(pageCount-1, value.page)) : 0,
    fraction: Number.isFinite(value?.fraction) ? Math.max(0, Math.min(.999999, value.fraction)) : 0,
    zoom: Number.isFinite(value?.zoom) ? Math.max(.5, Math.min(3, value.zoom)) : 1
  };
}
class PageQueue {
  constructor() { this.items = []; this.explicit = new Set(); }
  get length() { return this.items.length; }
  add(pages, { automatic = false, prioritize = true } = {}) {
    const wanted = new Set(pages), dropped = [];
    if (!automatic) for (const page of pages) this.explicit.add(page);
    this.items = this.items.filter(page => {
      if (wanted.has(page)) return false;
      if (automatic && !this.explicit.has(page)) { dropped.push(page); return false; }
      return true;
    });
    this.items = prioritize ? [...wanted, ...this.items] : [...this.items, ...wanted];
    return dropped;
  }
  shift() { const page = this.items.shift(); this.explicit.delete(page); return page; }
  requeue(page, explicit = false) { if (!this.items.includes(page)) this.items.push(page); if (explicit) this.explicit.add(page); }
  clear() { this.items = []; this.explicit.clear(); }
}
function mayTranslate(doc, index, automatic = false) {
  const blocked = new Set(['chinese', 'needs-ocr', 'no-text']);
  return Boolean(doc?.pages[index]) && !blocked.has(doc.pages[index].translationKind)
    && !(automatic && blocked.has(doc.translationProfile?.kind));
}
module.exports = { cacheKey, parseRange, validSettings, readingPosition, PageQueue, mayTranslate };
