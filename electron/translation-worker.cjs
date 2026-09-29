const { spawn } = require('node:child_process');
const readline = require('node:readline');

class TranslationWorker {
  constructor(command, redact = text => text) { this.command = command; this.redact = redact; this.child = null; this.active = null; this.sequence = 0; }
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
      if (event.type === 'progress') job.progress(event);
      else if (event.type === 'finish' || event.type === 'error') {
        this.active = null; clearTimeout(job.timer);
        event.type === 'finish' ? job.resolve(event) : job.reject(new Error(this.redact(event.error || '翻译失败')));
      }
    });
    const failed = message => {
      if (this.child === child) this.child = null;
      if (this.active?.child === child) { const job = this.active; this.active = null; clearTimeout(job.timer); job.reject(new Error(message)); }
    };
    child.on('error', () => failed('翻译进程无法启动，请重新安装或重试。'));
    child.on('exit', code => failed(`翻译进程已退出 (${code})。${diagnostic.slice(-500)}`));
  }
  run(request, cwd, progress) {
    if (this.active) return Promise.reject(new Error('已有页面正在翻译。'));
    this.start(cwd);
    const child = this.child, id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.stop('翻译超时，请重试。'), 15 * 60 * 1000);
      this.active = { child, id, resolve, reject, progress, timer };
      child.stdin.write(JSON.stringify({ ...request, id }) + '\n', error => { if (error && this.active?.id === id) this.stop('翻译进程通信失败。'); });
    });
  }
  stop(reason = '翻译已暂停。') {
    if (this.active) { const job = this.active; this.active = null; clearTimeout(job.timer); job.reject(new Error(reason)); }
    const child = this.child; this.child = null;
    if (child?.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else child.kill();
    }
  }
}
module.exports = { TranslationWorker };
