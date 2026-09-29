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
