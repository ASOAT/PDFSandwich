import { useEffect, useRef } from 'react';
import { Download, RefreshCw, RotateCw, ExternalLink } from 'lucide-react';
import type { UpdateState } from './types';

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;
export function UpdatePanel({ update, onAction, onPreference, focus }: { focus: boolean; update: UpdateState | null; onAction: (action: string) => void; onPreference: (enabled: boolean) => void }) {
  const card=useRef<HTMLElement>(null);
  useEffect(()=>{if(focus)card.current?.scrollIntoView({block:'center'});},[focus,Boolean(update)]);
  if (!update) return null;
  const { status, retry } = update;
  const download = status === 'available' || (status === 'error' && retry === 'download');
  const install = status === 'downloaded' || (status === 'error' && retry === 'install');
  const checking = status === 'checking';
  const text = status === 'disabled' ? '开发运行模式，安装版支持应用内更新。'
    : status === 'current' ? '当前已是最新版本。'
    : checking ? '正在检查新版本…'
    : status === 'available' ? `发现新版本 ${update.version}`
    : status === 'downloading' ? `正在下载 ${update.version} · ${Math.floor(update.percent)}%`
    : status === 'downloaded' ? `${update.version} 已准备好，重启后完成安装。`
    : status === 'installing' ? '正在保存阅读状态并准备安装…'
    : status === 'error' ? update.error : '可在这里检查并安装新版本。';
  return <section ref={card} className="update-card" aria-label="软件更新">
    <div className="update-heading"><h3>软件更新</h3><span>当前版本 {update.currentVersion}</span></div>
    <p role="status">{text}</p>
    {update.error && status !== 'error' && <p className="update-error">{update.error}</p>}
    {status === 'downloading' && <div className="update-progress"><progress aria-label="更新下载进度" max={100} value={update.percent}/><div><span>{update.total ? `${mb(update.transferred)} / ${mb(update.total)}` : '正在计算需要下载的内容…'}</span><span>{update.bytesPerSecond > 0 ? `${mb(update.bytesPerSecond)}/s` : ''}</span></div></div>}
    <div className="update-actions">
      {download ? <button className="button primary compact" onClick={() => onAction('updateDownload')}><Download size={15}/>下载更新</button>
        : install ? <button className="button primary compact" onClick={() => onAction('updateInstall')}><RotateCw size={15}/>重启并安装</button>
        : status === 'downloading' ? <button className="button secondary compact" onClick={() => onAction('updateCancel')}>取消下载</button>
        : <button className="button secondary compact" disabled={checking || status === 'disabled' || status === 'installing'} onClick={() => onAction('updateCheck')}><RefreshCw size={15} className={checking ? 'spin' : ''}/>{checking ? '正在检查' : '检查更新'}</button>}
      <button className="update-release" onClick={() => onAction('updateRelease')}>版本说明<ExternalLink size={13}/></button>
    </div>
    <label className="update-option"><input type="checkbox" checked={update.autoCheck} disabled={status === 'disabled' || status === 'installing'} onChange={event => onPreference(event.target.checked)}/>自动检查新版本</label>
    <small>优先下载变化部分，必要时自动下载完整更新包。下载后由你选择重启安装，离线模型与阅读数据会保留。</small>
  </section>;
}
