import type { PageInfo, Point, Rect } from './types';
export function viewSize(info: PageInfo): Point { return info.rotation % 180 ? [info.height, info.width] : [info.width, info.height]; }
export function toView([x, y]: Point, info: PageInfo): Point {
  if (info.rotation === 90) return [info.height-y, x];
  if (info.rotation === 180) return [info.width-x, info.height-y];
  if (info.rotation === 270) return [y, info.width-x];
  return [x,y];
}
export function fromView([x,y]: Point, info: PageInfo): Point {
  if (info.rotation === 90) return [y, info.height-x];
  if (info.rotation === 180) return [info.width-x, info.height-y];
  if (info.rotation === 270) return [info.width-y, x];
  return [x,y];
}
export function transformRect(rect: Rect, info: PageInfo, reverse = false): Rect {
  const convert = reverse ? fromView : toView;
  const a = convert([rect[0],rect[1]], info), b = convert([rect[2],rect[3]], info);
  return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
}

export function mergeRects(rects: Rect[]): Rect[] {
  const result: Rect[] = [];
  for (const rect of [...rects].sort((a,b)=>a[1]-b[1]||a[0]-b[0])) {
    let box: Rect = [...rect];
    if (box.some(v=>!Number.isFinite(v)) || box[2]<=box[0] || box[3]<=box[1]) continue;
    for (let i=0;i<result.length;) {
      const other=result[i], h=Math.min(box[3]-box[1],other[3]-other[1]);
      const sameLine=Math.min(box[3],other[3])-Math.max(box[1],other[1])>=h*.7 && Math.abs((box[1]+box[3]-other[1]-other[3])/2)<=h*.35;
      if(sameLine&&box[0]<=other[2]+.5&&other[0]<=box[2]+.5){box=[Math.min(box[0],other[0]),Math.min(box[1],other[1]),Math.max(box[2],other[2]),Math.max(box[3],other[3])];result.splice(i,1);i=0;}else i++;
    }
    result.push(box);
  }
  return result.sort((a,b)=>a[1]-b[1]||a[0]-b[0]);
}
