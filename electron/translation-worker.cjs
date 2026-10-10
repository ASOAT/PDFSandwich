const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const cancelledError = () => Object.assign(new Error('已让出后台任务，优先翻译当前页。'), { code: 'TRANSLATION_CANCELLED' });

class TranslationWorker {
  constructor(command, redact = text => text, {idleMs=5*60*1000}={}) { this.command = command; this.redact = redact; this.child = null; this.active = null; this.sequence = 0; this.idleMs=idleMs; }
  scheduleIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer=setTimeout(()=>{if(!this.active)void this.stop();},this.idleMs);
    this.idleTimer.unref?.();
  }
  start(cwd) {
    if (this.child) return;
    const command = this.command();
    const child = spawn(command.exe, command.args, { cwd, windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    this.child = child;
    let diagnostic = '';
    child.stderr.on('data', data => { diagnostic = (diagnostic + this.redact(data.toString())).slice(-1500); });
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let event; try { event = JSON.parse(line); } catch { return; }
      const job = this.active;
      if (!job || job.child !== child || event.id !== job.id) return;
      if (event.type === 'progress') { job.timer.refresh();job.progress(event); }
      else if (['finish', 'error', 'cancelled'].includes(event.type)) {
        this.active = null; this.cleanup(job);
        this.scheduleIdle();
        if (event.type === 'cancelled' || job.cancelRequested) job.reject(cancelledError());
        else event.type === 'finish' ? job.resolve(event) : job.reject(new Error(this.redact(event.error || '翻译失败')));
      }
    });
    const failed = message => {
      if (this.child === child) this.child = null;
      if (this.active?.child === child) { const job = this.active; this.active = null; this.cleanup(job); job.reject(job.cancelRequested ? cancelledError() : new Error(message)); }
    };
    child.on('error', () => failed('翻译进程无法启动，请重新安装或重试。'));
    child.on('exit', code => failed(`翻译进程已退出 (${code})。${diagnostic.slice(-500)}`));
  }
  run(request, cwd, progress) {
    if (this.active) return Promise.reject(new Error('已有页面正在翻译。'));
    clearTimeout(this.idleTimer);
    this.start(cwd);
    const child = this.child, id = ++this.sequence;
    const controlDir = path.join(cwd, 'translation-control');
    fs.mkdirSync(controlDir, { recursive: true });
    const cancelFile = path.join(controlDir, randomUUID() + '.cancel');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('翻译超时，请重试。'), 15 * 60 * 1000);
      this.active = { child, id, resolve, reject, progress, timer, cancelFile };
      child.stdin.write(JSON.stringify({ ...request, id, cancelFile }) + '\n', error => { if (error && this.active?.id === id) this.stop('翻译进程通信失败。'); });
    });
  }
  cleanup(job) {
    clearTimeout(job.timer); clearTimeout(job.cancelTimer);
    fs.rmSync(job.cancelFile, { force: true });
  }
  cancel() {
    const job = this.active;
    if (!job || job.cancelRequested) return;
    fs.writeFileSync(job.cancelFile, 'cancel'); job.cancelRequested = true;
    // Normal cancellation yields after the current short segment. Only an
    // unresponsive worker needs a cold restart, never every ordinary page turn.
    job.cancelTimer = setTimeout(() => this.stop(), 30000);
  }
  stop(reason = '翻译已暂停。') {
    clearTimeout(this.idleTimer);
    if (this.active) { const job = this.active; this.active = null; this.cleanup(job); job.reject(job.cancelRequested ? cancelledError() : new Error(reason)); }
    const child = this.child; this.child = null;
    if (child?.pid) {
      // Wait for the process tree to exit before Electron closes. Otherwise its
      // worker can disappear before taskkill discovers the llama-server child.
      const stopping = new Promise(resolve => {
        if (process.platform === 'win32') {
          const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('close', resolve); killer.once('error', () => { child.kill(); resolve(); });
        } else { child.once('exit', resolve); child.kill(); }
      });
      this.stopping = Promise.all([this.stopping, stopping]).then(() => undefined);
    }
    return this.stopping || Promise.resolve();
  }
}
module.exports = { TranslationWorker };
