import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { X, Upload, RotateCcw } from 'lucide-react';
import { defaultSignals, directions, SignalArt, type SignalConfig, type Signal } from './signal-types';
import './signal-editor.css';

type Crop = { bitmap:ImageBitmap; slot:number; name:string };
export default function SignalEditor({value,onSave,onClose}:{value:SignalConfig;onSave:(value:SignalConfig)=>void;onClose:()=>void}) {
  const [draft,setDraft]=useState(()=>structuredClone(value));
  const [selected,setSelected]=useState(0),[crop,setCrop]=useState<Crop|null>(null);
  const [zoom,setZoom]=useState(1),[offset,setOffset]=useState({x:0,y:0});
  const [error,setError]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
  const request=useRef(0),dialog=useRef<HTMLElement>(null),canvas=useRef<HTMLCanvasElement>(null),upload=useRef<HTMLInputElement>(null);
  const drag=useRef<{x:number;y:number;ox:number;oy:number}|null>(null);
  const item=draft.slots[selected];
  function change(patch:Partial<Signal>){setDraft(current=>({...current,slots:current.slots.map((s,i)=>i===selected?{...s,...patch}:s)}));}
  useEffect(()=>()=>{request.current++;},[]);
  useEffect(()=>()=>crop?.bitmap.close(),[crop]);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();if(!saving&&!loading){if(crop)setCrop(null);else onClose();}}
      if(e.key==='Tab'){
        const controls=[...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,[tabindex="0"]')||[])].filter(el=>el.getClientRects().length);
        const first=controls[0],last=controls.at(-1);
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('keydown',key,true);previous?.focus();};
  },[crop,saving,loading,onClose]);
  useEffect(()=>{
    if(!crop||!canvas.current)return;
    const ctx=canvas.current.getContext('2d')!;
    const scale=256/Math.min(crop.bitmap.width,crop.bitmap.height)*zoom;
    const w=crop.bitmap.width*scale,h=crop.bitmap.height*scale;
    ctx.clearRect(0,0,256,256);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
    ctx.drawImage(crop.bitmap,(256-w)/2+offset.x,(256-h)/2+offset.y,w,h);
  },[crop,zoom,offset]);
  async function read(file?:File){
    if(!file)return;const token=++request.current;setError('');setLoading(true);
    try{
      if(!/\.(png|jpe?g|webp|gif)$/i.test(file.name))throw new Error('支持 PNG、JPG、WebP 和 GIF 图片。');
      if(file.size>20*1024*1024)throw new Error('请选择 20 MB 以内的图片。');
      const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(token!==request.current){bitmap.close();return;}
      if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000){bitmap.close();throw new Error('图片尺寸过大，请先缩小到 4000 万像素以内。');}
      setCrop({bitmap,slot:selected,name:file.name});setZoom(1);setOffset({x:0,y:0});
    }catch(e){if(token===request.current)setError((e as Error).message||'无法读取图片。');}
    finally{if(token===request.current)setLoading(false);if(upload.current)upload.current.value='';}
  }
  function useCrop(){
    if(!canvas.current||!crop)return;
    const data=canvas.current.toDataURL('image/png');
    setDraft(current=>({...current,slots:current.slots.map((s,i)=>i===crop.slot?{...s,kind:'image',value:data}:s)}));setCrop(null);
  }
  async function save(){
    setSaving(true);setError('');
    try{const result=await window.pdfsandwich.call<SignalConfig>('signalsSave',draft);onSave(result);}
    catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /,''));}
    finally{setSaving(false);}
  }
  function move(e:PointerEvent<HTMLCanvasElement>){
    if(!drag.current||!e.currentTarget.hasPointerCapture(e.pointerId))return;
    const ratio=256/e.currentTarget.getBoundingClientRect().width;
    setOffset({x:Math.max(-255,Math.min(255,drag.current.ox+(e.clientX-drag.current.x)*ratio)),y:Math.max(-255,Math.min(255,drag.current.oy+(e.clientY-drag.current.y)*ratio))});
  }
  return <div className="signal-editor-backdrop"><section ref={dialog} className="signal-editor" role="dialog" aria-modal="true" aria-label="自定义表情轮盘" onKeyDown={e=>e.stopPropagation()}>
    <header><div><h2>{crop?'裁剪表情':'自定义表情轮盘'}</h2><p>{crop?'拖动图片调整位置，缩放后保存。':'选择一个方向，设置它发送的表情。'}</p></div><button className="icon-button" aria-label="关闭轮盘设置" disabled={saving||loading} onClick={onClose}><X size={20}/></button></header>
    {crop?<div className="signal-crop-body"><canvas ref={canvas} width={256} height={256} className="signal-crop-canvas" tabIndex={0} role="img" aria-label="表情裁剪预览，可拖动或使用方向键"
      onPointerDown={e=>{if(e.button!==0)return;e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);drag.current={x:e.clientX,y:e.clientY,ox:offset.x,oy:offset.y};}}
      onPointerMove={move} onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}
      onKeyDown={e=>{const d={ArrowLeft:[-4,0],ArrowRight:[4,0],ArrowUp:[0,-4],ArrowDown:[0,4]}[e.key];if(d){e.preventDefault();e.stopPropagation();setOffset(p=>({x:Math.max(-255,Math.min(255,p.x+d[0])),y:Math.max(-255,Math.min(255,p.y+d[1]))}));}}}/>
      <label>缩放<input aria-label="表情缩放" type="range" min={Math.min(crop.bitmap.width,crop.bitmap.height)/Math.max(crop.bitmap.width,crop.bitmap.height)} max="4" step="0.01" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
      <div className="signal-crop-fit"><button className="button secondary" onClick={()=>{setZoom(Math.min(crop.bitmap.width,crop.bitmap.height)/Math.max(crop.bitmap.width,crop.bitmap.height));setOffset({x:0,y:0});}}>完整图片</button><button className="button secondary" onClick={()=>{setZoom(1);setOffset({x:0,y:0});}}>填满画布</button></div><p>保留透明背景，保存为 256 × 256 PNG。GIF 使用静态首帧。</p>
    </div>:<div className="signal-editor-body"><nav aria-label="轮盘方向" className="signal-slot-list">{draft.slots.map((s,i)=><button key={i} className={i===selected?'selected':''} aria-pressed={i===selected} disabled={loading||saving} onClick={()=>{setSelected(i);setError('');}}><span className="signal-slot-art" style={{color:s.color}}><SignalArt item={s}/></span><span><b>{directions[i]}</b><small>{s.label}</small></span></button>)}</nav>
      <div className="signal-slot-form"><div className={`signal-editor-preview ${item.kind==='image'?'image':''}`} style={{color:item.color}}><SignalArt item={item} ping/></div>
        <label>名称<input aria-label="表情名称" maxLength={16} value={item.label} onChange={e=>change({label:e.target.value})}/></label>
        <label>表情类型<select aria-label="表情类型" value={item.kind} onChange={e=>{const kind=e.target.value as Signal['kind'];if(kind==='image'){upload.current?.click();return;}change({kind,value:kind==='emoji'?'🙂':defaultSignals[selected].value});}}><option value="builtin">内置图标</option><option value="emoji">Emoji</option><option value="image">上传图片</option></select></label>
        {item.kind==='builtin'&&<label>图标<select aria-label="内置表情" value={item.value} onChange={e=>change({value:e.target.value})}>{defaultSignals.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}</select></label>}
        {item.kind==='emoji'&&<label>Emoji<input aria-label="Emoji 内容" maxLength={24} value={item.value} onChange={e=>change({value:e.target.value})}/></label>}
        <div className="signal-form-row"><label>信号颜色<input aria-label="信号颜色" type="color" value={item.color} onChange={e=>change({color:e.target.value})}/></label><button className="button secondary" disabled={loading||saving} onClick={()=>upload.current?.click()}><Upload size={15}/>{loading?'读取图片…':item.kind==='image'?'更换图片':'上传图片'}</button></div>
        <input ref={upload} aria-label="选择表情图片" type="file" accept=".png,.jpg,.jpeg,.webp,.gif" hidden onChange={e=>void read(e.target.files?.[0])}/>
        <button className="signal-restore-slot" onClick={()=>change({...defaultSignals[selected]})}><RotateCcw size={14}/>恢复此方向默认表情</button>
      </div></div>}
    {error&&<p className="signal-editor-error" role="alert">{error}</p>}
    <footer>{crop?<><button className="button secondary" onClick={()=>setCrop(null)}>返回</button><button className="button" onClick={useCrop}>使用这张表情</button></>:<><button className="button secondary" disabled={saving||loading} onClick={()=>{setDraft({version:1,slots:structuredClone(defaultSignals)});setError('');}}>全部恢复默认</button><div><button className="button secondary" disabled={saving||loading} onClick={onClose}>取消</button><button className="button" disabled={saving||loading} onClick={()=>void save()}>{saving?'保存中…':'保存轮盘'}</button></div></>}</footer>
  </section></div>;
}
