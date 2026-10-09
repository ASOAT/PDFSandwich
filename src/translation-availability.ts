import type { Document } from './types';

export function translationNotice(doc:Document,page:number) {
  const kind=doc.pages[page]?.translationKind ?? doc.translationProfile?.kind;
  if(kind==='chinese')return '此页为中文，无需翻译';
  if(kind==='needs-ocr')return '此页需要 OCR，未加载翻译服务';
  if(kind==='no-text')return '此页没有可翻译文字';
  return '';
}
