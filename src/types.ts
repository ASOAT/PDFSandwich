export type Side = 'en' | 'zh';
export type Rect = [number, number, number, number];
export type Point = [number, number];
export type Tool = 'select' | 'highlight' | 'underline' | 'ink' | 'note';
export type Geometry = { rects: Rect[]; paths?: Point[][] };
export type Mark = { id: string; page: number; kind: Exclude<Tool, 'select'>; color: string; width: number; content: string; origin: Side; en?: Geometry | null; zh?: Geometry | null; accuracy: string; selectedText?: string };
export type PageInfo = { width: number; height: number; rotation: number };
export type Translation = { status: 'idle' | 'queued' | 'translating' | 'ready' | 'error'; progress: number; stage?: string; error?: string; path?: string; url?: string };
export type Document = { id: string; path: string; name: string; pages: PageInfo[]; size: number; sourceUrl: string; annotations: Mark[]; translations: Record<number, Translation>; currentPage: number; dirty: boolean; backup?: string; outline: [number, string, number][] };
export type Settings = { provider: 'local' | 'api'; baseUrl: string; model: string; autoTranslate: boolean; hasKey: boolean };
export type State = { doc: Document | null; settings: Settings; recent: { name: string; path: string; pages: number; openedAt: number }[]; canUndo: boolean; canRedo: boolean; queued: number; translating: boolean };
export type Match = { page: number; rects: Rect[]; text: string };
declare global { interface Window { pdfsandwich: { call: <T = unknown>(action: string, args?: unknown) => Promise<T>; pathForFile: (file: File) => string; onState: (callback: (state: State) => void) => () => void } } }
