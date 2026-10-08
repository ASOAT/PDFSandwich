import {lazy,Suspense,type ComponentProps} from 'react';
const LazyNotes=lazy(()=>import('./NotesPanel').then(module=>({default:module.NotesPanel})));
const LazyExcerpt=lazy(()=>import('./ReadingResearch').then(module=>({default:module.ExcerptDialog})));
const loading=<p className="muted" role="status">正在打开…</p>;
export function NotesPanel(props:ComponentProps<typeof LazyNotes>){return <Suspense fallback={loading}><LazyNotes {...props}/></Suspense>;}
export function ExcerptDialog(props:ComponentProps<typeof LazyExcerpt>){return <Suspense fallback={loading}><LazyExcerpt {...props}/></Suspense>;}
