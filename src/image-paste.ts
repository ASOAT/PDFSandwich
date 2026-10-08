import {api} from './research-types';
export function pastedImage(data:DataTransfer|null){
  return Array.from(data?.items||[]).find(item=>item.kind==='file'&&/^image\/(png|jpeg|webp|gif|bmp)$/.test(item.type))?.getAsFile()||null;
}
export async function savePastedImage(file:File,id:string,content:string){
  if(file.size>30*1024*1024)throw new Error('图片超过 30 MB，请缩小后粘贴。');
  const png=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('无法读取剪贴板图片。'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
  return api<{markdown:string;name:string}>('notesPasteImage',{id,png,content});
}
export function mapOffset(offset:number,before:string,after:string){
  let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  let end=before.length,next=after.length;while(end>start&&next>start&&before[end-1]===after[next-1]){end--;next--;}
  return offset<=start?offset:offset>=end?offset+next-end:next;
}
