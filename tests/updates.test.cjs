const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateController } = require('../electron/updates.cjs');

function setup(overrides = {}) {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => { updater.emit('update-available', { version: '0.5.0' }); return {}; };
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '0.5.0' });
  let installs = 0;
  updater.quitAndInstall = (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); installs++; };
  const controller = new UpdateController({ updater, version: '0.4.0', createToken: () => ({ cancelled: false, cancel() { this.cancelled = true; this.onCancel?.(); } }), ...overrides });
  return { updater, controller, installs: () => installs };
}
test('checking never downloads automatically; install waits for document preparation', async () => {
  let allow;
  const { updater, controller, installs } = setup({ beforeInstall: () => new Promise(resolve => { allow = resolve; }) });
  assert.equal(updater.autoDownload, false); assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.disableDifferentialDownload, false); assert.equal(updater.allowDowngrade, false);
  await controller.check(); assert.equal(controller.snapshot().status, 'available');
  await controller.download(); assert.equal(controller.snapshot().status, 'downloaded');
  const installing = controller.install();
  await controller.install(); assert.equal(installs(), 0);
  allow(true); await installing; assert.equal(installs(), 1);
});
test('canceling the save prompt and a failed save both preserve the downloaded update', async () => {
  let fail = false;
  const { controller, installs } = setup({ beforeInstall: async () => { if (fail) throw new Error('PDF locked'); return false; } });
  await controller.check(); await controller.download(); await controller.install();
  assert.equal(controller.snapshot().status, 'downloaded'); assert.equal(installs(), 0);
  fail = true; await controller.install();
  assert.equal(controller.snapshot().status, 'downloaded'); assert.match(controller.snapshot().error, /更新未安装/); assert.equal(installs(), 0);
});
test('network failure can be retried, duplicate checks and downloads are coalesced', async () => {
  const { updater, controller } = setup(); let resolve, checks = 0;
  updater.checkForUpdates = () => { checks++; return new Promise(r => { resolve = r; }); };
  const first = controller.check(), second = controller.check();
  await Promise.resolve(); assert.equal(checks, 1);
  updater.emit('update-available', { version: '0.5.0' }); resolve({}); await Promise.all([first, second]);
  let downloads = 0;
  updater.downloadUpdate = async () => { downloads++; throw new Error('timeout'); };
  await Promise.all([controller.download(), controller.download()]);
  assert.equal(downloads, 1); assert.equal(controller.snapshot().retry, 'download');
  updater.downloadUpdate = async () => updater.emit('update-downloaded', { version: '0.5.0' });
  await controller.download(); assert.equal(controller.snapshot().status, 'downloaded');
});
test('cancel download drains before retry; progress cannot overwrite downloaded state', async () => {
  const { updater, controller } = setup(); await controller.check();
  updater.downloadUpdate = token => new Promise((_, reject) => { token.onCancel = () => reject(new Error('cancelled')); });
  const task = controller.download(); await Promise.resolve();
  updater.emit('download-progress', { percent: 26, transferred: 10, total: 40, bytesPerSecond: 5 });
  assert.equal(controller.snapshot().percent, 26);
  controller.cancel(); await task; assert.equal(controller.snapshot().status, 'available');
  updater.emit('update-downloaded', { version: '0.5.0' });
  updater.emit('download-progress', { percent: 30 }); assert.equal(controller.snapshot().percent, 100);
});
test('installer launch errors unlock the app and remain retryable', async () => {
  let unlocked = false;
  const { updater, controller } = setup({ installFailed: () => { unlocked = true; } });
  await controller.check(); await controller.download();
  updater.quitAndInstall = () => updater.emit('error', new Error('spawn failed'));
  await controller.install(); assert.equal(unlocked, true); assert.equal(controller.snapshot().retry, 'install');
});
test('disabled development updater never checks or installs; preference is persisted', async () => {
  let stored;
  const controller = new UpdateController({ version: '0.4.0', savePreference: value => { stored = value; } });
  await controller.check(); await controller.download(); await controller.install();
  assert.equal(controller.snapshot().status, 'disabled'); controller.preference(false); assert.equal(stored, false);
  assert.throws(() => controller.preference('https://untrusted.example')); controller.dispose();
});
