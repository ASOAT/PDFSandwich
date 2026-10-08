import type { Rect } from './types';
export type Note={id:string;relative:string;title:string;documentId:string;category:string;tags:string[];modified:number;content:string;version:string};
export type NotesConfig={mode:'standalone'|'obsidian';standaloneRoot:string;vault:string;notesFolder:string;templateFile:string;root:string;attachmentDirectory:string};
export type Excerpt={source:string;translation:string;page:number;annotationId?:string;rects:Rect[]};
export type Capture={id:string;png:string;text:string;rect:Rect;page:number;side:'en'|'zh'};
export type ResearchEvent={type:string;id?:string;error?:string;settings?:NotesConfig;documentId?:string;page?:number;rect?:Rect;annotationId?:string};
export const api=<T=unknown>(action:string,args?:unknown)=>window.pdfsandwich.call<T>(action,args);
export const errorText=(error:unknown)=>String((error as Error)?.message||error).replace(/^Error invoking remote method '[^']+': Error: /,'');
