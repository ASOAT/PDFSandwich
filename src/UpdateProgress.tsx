import { RefreshCw, Check } from 'lucide-react';
import type { UpdateState } from './types';
import './update-progress.css';
export function UpdateProgress({update}:{update:UpdateState|null}) {
  const p=update?.progress;if(!p)return null;
  const restarting=p.phase==='restarting',handoff=p.phase==='handoff';
  const steps=restarting?['启动阅读器','恢复阅读文档']:['保存笔记','保存 PDF 批注','停止翻译与对应任务','写入译文与阅读位置','关闭后台服务'];
  return <div className="update-stage-backdrop"><section className="update-stage" role="dialog" aria-modal="true" aria-label={restarting?'更新后重新启动':'准备安装更新'}>
    <div className="update-stage-icon"><RefreshCw className="spin" size={25}/></div><h2>{restarting?'正在重新启动 PDFSandwich':'正在准备安装更新'}</h2>
    <p className="update-stage-version">{restarting?`版本 ${update.currentVersion}`:update.version?`更新至 ${update.version}`:''}</p>
    <p className="update-stage-label" role="status" aria-live="polite">{p.label}</p>
    <progress aria-label={restarting?'启动步骤进度':'安装准备步骤进度'} max={p.total} value={p.completed}/>
    <div className="update-stage-count">已完成 {p.completed} / {p.total} 项{restarting?'启动':'准备'}步骤</div>
    <ol>{steps.map((text,i)=><li key={text} className={i<p.completed?'done':i===p.completed?'current':''}><span>{i<p.completed?<Check size={13}/>:i+1}</span>{text}</li>)}</ol>
    <small>{restarting?'文档恢复后自动进入阅读界面。':handoff?'接下来由安装器显示文件安装进度，完成后自动重新启动。':'正在保存阅读数据，随后将显示安装进度窗口。'}</small>
  </section></div>;
}
