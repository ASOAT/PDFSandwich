import { CircleHelp, CircleAlert, ThumbsUp, Lightbulb, Laugh, Heart } from 'lucide-react';
import defaults from '../electron/signal-defaults.json';
export type Signal = {kind:'builtin'|'emoji'|'image';value:string;label:string;color:string};
export type SignalConfig = {version:1;slots:Signal[]};
export const defaultSignals = defaults as Signal[];
export const directions = ['左','左上','右上','右','右下','左下'];
const icons = {question:CircleHelp,alert:CircleAlert,agree:ThumbsUp,idea:Lightbulb,laugh:Laugh,heart:Heart};
export function SignalArt({item,ping=false}:{item:Signal;ping?:boolean}) {
  if(item.kind==='image')return <img src={item.value} alt="" className="signal-image" draggable={false}/>;
  if(item.kind==='emoji')return <span className="signal-emoji">{item.value}</span>;
  if(ping&&item.value==='question')return <b className="signal-question-symbol">?</b>;
  const Icon=icons[item.value as keyof typeof icons]||CircleHelp;
  return <Icon size={ping?32:25} strokeWidth={ping?2.4:2}/>;
}
