import { useEffect, useRef, useState, lazy, Suspense, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Radar, SlidersHorizontal } from 'lucide-react';
import { defaultSignals, SignalArt, type SignalConfig } from './signal-types';
const SignalEditor=lazy(()=>import('./SignalEditor'));
import './reader-signals.css';

type Gesture = { x: number; y: number; selected: number };
type Ping = { id: number; x: number; y: number; selected: number };
// Clockwise from west: Alt + drag left is the familiar question-mark gesture.
function selection(dx: number, dy: number) {
  if (Math.hypot(dx, dy) < 36) return -1;
  return Math.round((Math.atan2(dx, -dy) + Math.PI / 2 + Math.PI * 2) / (Math.PI / 3)) % 6;
}

export function ReaderSignals({ active, viewKey }: { active: boolean; viewKey: string }) {
  const [config,setConfig]=useState<SignalConfig>({version:1,slots:defaultSignals});
  const [editing,setEditing]=useState(false),[loaded,setLoaded]=useState(false),[loadError,setLoadError]=useState('');
  const signals=config.slots;
  useEffect(()=>{let live=true;window.pdfsandwich.call<SignalConfig>('signalsGet').then(value=>{if(live)setConfig(value);}).catch(()=>{if(live)setLoadError('无法读取已保存的轮盘配置。保存设置后可重新建立配置。');}).finally(()=>{if(live)setLoaded(true);});return()=>{live=false;};},[]);
  const [enabled, setEnabled] = useState(() => localStorage.getItem('reader-signals') !== 'off');
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [pings, setPings] = useState<Ping[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const sequence = useRef(0);
  useEffect(() => {
    setGesture(null); setPings([]); setAnnouncement('');
    if (!active || !enabled || editing) return;
    let current: Gesture | null = null;
    let cursor: { x: number; y: number; buttons: number } | null = null;
    let altHeld = false, deferredStart = false, mouseHeld = false;
    let suppressUntil = 0, lastSent = -Infinity;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stop = (e: Event) => { e.preventDefault(); e.stopImmediatePropagation(); };
    const cancel = () => { current = null; deferredStart = false; setGesture(null); };
    const clear = () => { cancel(); timers.forEach(clearTimeout); timers.clear(); setPings([]); setAnnouncement(''); };
    const blur = () => { clear(); altHeld = false; mouseHeld = false; cursor = null; };
    const start = () => {
      if (!cursor || cursor.buttons) return;
      const target = document.elementFromPoint(cursor.x, cursor.y)?.closest('.pdf-surface');
      if (!target || target.querySelector('.page-rendering,.page-error') ||
          document.querySelector('[role="dialog"],.modal-backdrop,.busy-overlay')) return;
      current = { x: cursor.x, y: cursor.y, selected: -1 }; setGesture(current);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      cursor = { x: e.clientX, y: e.clientY, buttons: e.buttons };
      if (deferredStart && e.altKey) { deferredStart = false; start(); }
      if (!current) return;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) { cancel(); return; }
      stop(e);
      current = { ...current, selected: selection(e.clientX-current.x, e.clientY-current.y) }; setGesture(current);
    };
    const down = (e: PointerEvent) => { if (current) { stop(e); mouseHeld = true; } };
    const up = (e: PointerEvent) => {
      if (current || mouseHeld) { stop(e); mouseHeld = false; suppressUntil = performance.now()+100; }
    };
    // Consume compatibility mouse events so optional clicks cannot create marks.
    const mouse = (e: Event) => { if (current || mouseHeld || performance.now() < suppressUntil) stop(e); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (current || timers.size)) { stop(e); clear(); return; }
      if (e.ctrlKey || e.metaKey || e.shiftKey) { cancel(); return; }
      if (e.key !== 'Alt' || e.repeat || altHeld) return;
      if (e.target instanceof Element && e.target.closest('input,textarea,select,[contenteditable="true"]')) return;
      altHeld = true; deferredStart = !cursor; start();
      if (current) stop(e);
    };
    const release = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      altHeld = false; deferredStart = false;
      if (!current) return;
      stop(e);
      const chosen = current.selected;
      if (chosen >= 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && cursor &&
          cursor.x >= 0 && cursor.y >= 0 && cursor.x < innerWidth && cursor.y < innerHeight && performance.now()-lastSent > 180) {
        const ping = { ...current, id: ++sequence.current };
        lastSent = performance.now(); setPings(items => [...items.slice(-5), ping]);
        setAnnouncement(`${signals[chosen].label}信号`);
        const timer = setTimeout(() => { timers.delete(timer); setPings(items => items.filter(p => p.id !== ping.id)); }, 2200);
        timers.add(timer);
      }
      cancel();
    };
    const cancelled = () => { mouseHeld = false; cancel(); };
    const visibility = () => { if (document.hidden) blur(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancelled, true);
    for (const type of ['mousedown','mouseup','click','dblclick','contextmenu','selectstart']) window.addEventListener(type, mouse, true);
    window.addEventListener('keydown', key, true); window.addEventListener('keyup', release, true);
    window.addEventListener('blur', blur); window.addEventListener('resize', clear);
    window.addEventListener('scroll', clear, true); document.addEventListener('visibilitychange', visibility);
    return () => {
      timers.forEach(clearTimeout);
      window.removeEventListener('pointerdown', down, true); window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true); window.removeEventListener('pointercancel', cancelled, true);
      for (const type of ['mousedown','mouseup','click','dblclick','contextmenu','selectstart']) window.removeEventListener(type, mouse, true);
      window.removeEventListener('keydown', key, true); window.removeEventListener('keyup', release, true);
      window.removeEventListener('blur', blur); window.removeEventListener('resize', clear);
      window.removeEventListener('scroll', clear, true); document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, enabled, viewKey, editing, config]);
  const title = `${enabled ? '关闭' : '开启'}互动信号 · 按住 Alt 移动鼠标，松开 Alt 发送，中心 / Esc 取消`;
  const radius = 116;
  return <><span className="signal-toolbar"><button className={`icon-button ${enabled ? 'selected' : ''}`} aria-label="互动信号" aria-pressed={enabled} title={title}
    onClick={() => setEnabled(value => { localStorage.setItem('reader-signals', value ? 'off' : 'on'); return !value; })}><Radar size={17}/></button><button className="icon-button signal-config-button" aria-label="自定义表情轮盘" title="自定义表情轮盘" disabled={!loaded} onClick={()=>setEditing(true)}><SlidersHorizontal size={13}/></button></span>
    {editing&&createPortal(<Suspense fallback={<div className="busy-overlay">正在打开轮盘设置…</div>}><SignalEditor value={config} onSave={value=>{setConfig(value);setLoadError('');setEditing(false);}} onClose={()=>setEditing(false)}/>{loadError&&<p className="signal-load-error" role="alert">{loadError}</p>}</Suspense>,document.body)}
    {createPortal(<div className="reader-signals" aria-label="阅读信号">
      {gesture && <div className="signal-wheel" role="status" aria-label="信号轮盘" style={{left:Math.max(radius,Math.min(innerWidth-radius,gesture.x)),top:Math.max(radius,Math.min(innerHeight-radius-36,gesture.y))}}>
        <svg viewBox="-116 -116 232 232" aria-hidden="true">{signals.map((item,i) => {
          const a=(i*60-210)*Math.PI/180,b=(i*60-150)*Math.PI/180;
          return <path key={i} className={gesture.selected===i?'active':''} style={{'--signal-color':item.color} as CSSProperties}
            d={`M ${Math.cos(a)*36} ${Math.sin(a)*36} L ${Math.cos(a)*112} ${Math.sin(a)*112} A 112 112 0 0 1 ${Math.cos(b)*112} ${Math.sin(b)*112} L ${Math.cos(b)*36} ${Math.sin(b)*36} A 36 36 0 0 0 ${Math.cos(a)*36} ${Math.sin(a)*36} Z`}/>;
        })}</svg>
        {signals.map((item,i) => <div key={i} className={`signal-option ${gesture.selected===i?'active':''}`} style={{left:116+Math.sin(i*Math.PI/3-Math.PI/2)*76,top:116-Math.cos(i*Math.PI/3-Math.PI/2)*76,color:item.color}}><SignalArt item={item}/><span>{item.label}</span></div>)}
        <div className="signal-center">{gesture.selected < 0 ? '取消' : signals[gesture.selected].label}</div>
        <div className="signal-hint">松开 Alt 发送 · Esc 取消</div>
      </div>}
      {pings.map(({id,x,y,selected}) => { const item=signals[selected],question=item.kind==='builtin'&&item.value==='question';return <div key={id} className={`reader-ping ${question?'reader-ping-question':''} ${item.kind!=='builtin'?'reader-ping-custom':''}`} data-signal={item.label} style={{left:x,top:y,'--signal-color':item.color} as CSSProperties}><i/><div><SignalArt item={item} ping/></div>{!question&&<span>{item.label}</span>}</div>; })}
      <span className="signal-announcement" role="status" aria-live="polite">{announcement}</span>
    </div>, document.body)}
  </>;
}
