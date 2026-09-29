import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
GlobalWorkerOptions.workerSrc = workerUrl;
type Cached = { promise: Promise<PDFDocumentProxy>; users: number; used: number; destroy: () => void };
const cache = new Map<string, Cached>();
export function acquirePdf(url: string) {
  let value = cache.get(url);
  if (!value) {
    const base = new URL('./pdfjs/', location.href).href;
    const task = getDocument({ url, cMapUrl: base+'cmaps/', cMapPacked: true, standardFontDataUrl: base+'standard_fonts/', wasmUrl: base+'wasm/', disableAutoFetch: true, disableStream: true });
    value = { promise: task.promise, users: 0, used: Date.now(), destroy: () => { void task.destroy(); } }; cache.set(url, value);
    task.promise.catch(() => cache.delete(url));
  }
  value.users++; value.used = Date.now();
  return { promise: value.promise, release: () => { value!.users = Math.max(0,value!.users-1); trim(); } };
}
function trim() { const unused = [...cache.entries()].filter(([,v])=>!v.users).sort((a,b)=>a[1].used-b[1].used); while (cache.size > 7 && unused.length) { const [key,value] = unused.shift()!; value.destroy(); cache.delete(key); } }
export function clearPdfCache() { for (const [key,value] of cache) if (!value.users) { value.destroy(); cache.delete(key); } }
