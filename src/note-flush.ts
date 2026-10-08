import { api } from './research-types';
const editors=new Set<()=>Promise<boolean>>();
export function registerNoteEditor(flush:()=>Promise<boolean>){editors.add(flush);return()=>{editors.delete(flush);};}
window.pdfsandwich.onEvent(event=>{if(event.type==='notes-request-flush'&&event.id)void Promise.all([...editors].map(flush=>flush().catch(()=>false))).then(results=>api('notesFlushed',{token:event.id,ok:results.every(Boolean)}));});
