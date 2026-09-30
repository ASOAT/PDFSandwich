export type Side = 'en' | 'zh';
export type Rect = [number, number, number, number];
export type Point = [number, number];
export type Tool = 'select' | 'highlight' | 'underline' | 'ink' | 'note';
export type Geometry = { rects: Rect[]; paths?: Point[][] };
export type Mark = { id: string; page: number; kind: Exclude<Tool, 'select'>; color: string; width: number; content: string; origin: Side; en?: Geometry | null; zh?: Geometry | null; accuracy: string; selectedText?: string; wholePage?: boolean; mappingVersion?: number };
export type PageInfo = { width: number; height: number; rotation: number };
export type Translation = { status: 'idle' | 'queued' | 'translating' | 'ready' | 'error'; progress: number; stage?: string; error?: string; path?: string; url?: string; warnings?: number; seconds?: number };
export type Document = { id: string; path: string; name: string; pages: PageInfo[]; size: number; sourceUrl: string; annotations: Mark[]; translations: Record<number, Translation>; currentPage: number; currentFraction: number; viewZoom: number; dirty: boolean; backup?: string; outline: [number, string, number][]; autoSave?:{status:'saving'|'saved'|'error';path?:string;error?:string;updatedAt?:number} };
export type Settings = { provider: 'local' | 'api'; localEngine: 'hy' | 'argos'; useGlossary: boolean; glossary: string; baseUrl: string; model: string; autoTranslate: boolean; saveTranslation: boolean; hasKey: boolean };
export type Collection = {id:string;name:string;parentId:string|null};
export type LibraryDocument = {id:string;path:string;name:string;title:string;authors:string;year:string;notes:string;tags:string[];collections:string[];pages:number;size:number;addedAt:number;lastOpenedAt:number;translatedPages:number;translationPath?:string;managed?:boolean;missing:boolean};
export type LibraryState = {storageRoot:string;collections:Collection[];documents:LibraryDocument[]};
export type State = { doc: Document | null; settings: Settings; recent: { name: string; path: string; pages: number; openedAt: number }[]; canUndo: boolean; canRedo: boolean; queued: number; translating: boolean };
export type Match = { page: number; rects: Rect[]; text: string };
export type UpdateState = { currentVersion: string; status: 'disabled'|'idle'|'checking'|'current'|'available'|'downloading'|'downloaded'|'installing'|'error'; autoCheck: boolean; version: string|null; percent: number; transferred: number; total: number; bytesPerSecond: number; lastChecked: number|null; error: string; retry?: 'check'|'download'|'install'|null };

declare global { interface Window { pdfsandwich: { call: <T = unknown>(action: string, args?: unknown) => Promise<T>; pathForFile: (file: File) => string; onUpdate: (callback: (state: UpdateState) => void) => () => void; onState: (callback: (state: State) => void) => () => void } } }
