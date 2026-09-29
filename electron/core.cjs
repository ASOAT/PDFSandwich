const crypto = require('node:crypto');
function cacheKey(stamp, settings) {
  return crypto.createHash('sha256').update(JSON.stringify({ stamp, provider: settings.provider || 'local', base: settings.provider === 'api' ? settings.baseUrl : '', model: settings.provider === 'api' ? settings.model : 'argos-en-zh-1.9', engine: 'pdf2zh-next-2.9.0', from: 'en', to: 'zh', version: 3 })).digest('hex').slice(0, 24);
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
  return { provider: value.provider || 'local', baseUrl: url.href.replace(/\/$/, '').replace(/\/chat\/completions$/, ''), model: value.model.trim(), autoTranslate: Boolean(value.autoTranslate) };
}
module.exports = { cacheKey, parseRange, validSettings };
