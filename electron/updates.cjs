// The renderer can request fixed update actions, never supply a feed or executable.
class UpdateController {
  constructor({ updater, version, autoCheck = true, onChange = () => {}, savePreference = () => {}, beforeInstall = async () => true, installFailed = () => {}, createToken }) {
    Object.assign(this, { updater, onChange, savePreference, beforeInstall, installFailed, createToken });
    this.value = { currentVersion: version, status: updater ? 'idle' : 'disabled', autoCheck, version: null, percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, lastChecked: null, error: '' };
    if (!updater) return;
    Object.assign(updater, { autoDownload: false, autoInstallOnAppQuit: false, allowPrerelease: false, allowDowngrade: false, disableDifferentialDownload: false, disableWebInstaller: true });
    updater.on('update-available', info => this.set({ status: 'available', version: info.version, lastChecked: Date.now(), error: '' }));
    updater.on('update-not-available', () => this.set({ status: 'current', version: null, lastChecked: Date.now(), error: '' }));
    updater.on('download-progress', info => { if (this.value.status === 'downloading') this.set({ percent: Math.min(100, Math.max(0, info.percent || 0)), transferred: info.transferred || 0, total: info.total || 0, bytesPerSecond: info.bytesPerSecond || 0 }); });
    updater.on('update-downloaded', info => this.set({ status: 'downloaded', version: info.version, percent: 100, error: '' }));
    updater.on('error', () => {
      if (this.token?.cancelled || this.value.status === 'error') return;
      this.fail(this.value.status);
    });
  }
  snapshot() { return { ...this.value }; }
  set(patch) { Object.assign(this.value, patch); this.onChange(this.snapshot()); }
  fail(stage) {
    if (stage === 'installing') this.installFailed();
    const error = stage === 'installing' ? '无法启动安装程序。请重试，或从版本页面下载安装。' : stage === 'downloading' ? '更新下载失败，请检查网络后重试。' : '暂时无法检查更新，请检查网络后重试。';
    this.set({ status: 'error', error, retry: stage === 'installing' ? 'install' : stage === 'downloading' ? 'download' : 'check' });
  }
  preference(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('无效的更新设置。');
    this.savePreference(enabled); this.set({ autoCheck: enabled });
    return this.snapshot();
  }
  check() {
    if (this.checkTask) return this.checkTask;
    if (!this.updater || ['downloading', 'downloaded', 'installing'].includes(this.value.status) || this.downloadTask) return Promise.resolve(this.snapshot());
    this.set({ status: 'checking', version: null, error: '', retry: null });
    this.checkTask = Promise.resolve().then(() => this.updater.checkForUpdates()).then(result => {
      if (!result && this.value.status === 'checking') this.set({ status: 'disabled' });
    }).catch(() => { if (this.value.status !== 'error') this.fail('checking'); }).finally(() => { this.checkTask = null; });
    return this.checkTask.then(() => this.snapshot());
  }
  download() {
    if (this.downloadTask) return this.downloadTask;
    if (!this.updater || !(this.value.status === 'available' || (this.value.status === 'error' && this.value.retry === 'download'))) return Promise.resolve(this.snapshot());
    this.token = this.createToken();
    this.set({ status: 'downloading', percent: 0, transferred: 0, total: 0, bytesPerSecond: 0, error: '', retry: null });
    this.downloadTask = Promise.resolve().then(() => this.updater.downloadUpdate(this.token)).catch(() => {
      if (this.token.cancelled) this.set({ status: 'available', percent: 0, error: '' });
      else if (this.value.status !== 'error') this.fail('downloading');
    }).finally(() => { this.token = null; this.downloadTask = null; });
    return this.downloadTask.then(() => this.snapshot());
  }
  cancel() { if (this.value.status === 'downloading') this.token?.cancel(); return this.snapshot(); }
  async install() {
    if (!this.updater || !(this.value.status === 'downloaded' || (this.value.status === 'error' && this.value.retry === 'install'))) return this.snapshot();
    this.set({ status: 'installing', error: '', retry: null });
    try {
      if (!await this.beforeInstall()) { this.set({ status: 'downloaded' }); return this.snapshot(); }
      this.updater.quitAndInstall(true, true);
    } catch {
      this.installFailed();
      this.set({ status: 'downloaded', error: '文档处理尚未完成，更新未安装。请等待当前操作完成并保存批注后重试。' });
    }
    return this.snapshot();
  }
  start() {
    if (!this.updater) return;
    const run = () => { if (this.value.autoCheck && ['idle', 'current', 'error'].includes(this.value.status)) void this.check(); };
    this.startTimer = setTimeout(run, 15000); this.startTimer.unref?.();
    this.interval = setInterval(run, 6 * 60 * 60 * 1000); this.interval.unref?.();
  }
  dispose() { clearTimeout(this.startTimer); clearInterval(this.interval); }
}
module.exports = { UpdateController };
