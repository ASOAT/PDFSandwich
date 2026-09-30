// Exercise the real NSIS downloader over HTTP with production installer bytes.
// Never execute an installer or touch the user's installed application/cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { NsisUpdater } = require('electron-updater');
const { NodeHttpExecutor } = require('builder-util/out/nodeHttpExecutor');
const { ElectronHttpExecutor } = require('electron-updater/out/electronHttpExecutor');
const { CURRENT_APP_INSTALLER_FILE_NAME } = require('builder-util-runtime');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const previous = process.env.PDFSANDWICH_PREVIOUS_VERSION || '0.4.0';
const directory = path.join(root, 'release', version);
const currentName = `PDFSandwich-Setup-${version}.exe`;
const oldName = fs.existsSync(path.join(root, 'release', previous, `PDFSandwich-Setup-${previous}.exe`))
  ? `PDFSandwich-Setup-${previous}.exe` : `PDFSandwich Setup ${previous}.exe`;
const manifest = yaml.load(fs.readFileSync(path.join(directory, 'latest.yml'), 'utf8'));
const expected = manifest.files[0].sha512;
const current = awaitableFile(path.join(directory, currentName));
function awaitableFile(file) { return { file, size: fs.statSync(file).size }; }
async function hash(file) { const digest = crypto.createHash('sha512'); for await (const chunk of fs.createReadStream(file)) digest.update(chunk); return digest.digest('base64'); }

async function scenario(mode) {
  const folder = await fsp.mkdtemp(path.join(root, 'tmp', 'update-transfer-'));
  const cache = path.join(folder, 'cache'); await fsp.mkdir(cache);
  const config = path.join(folder, 'app-update.yml');
  await fsp.writeFile(config, 'updaterCacheDirName: cache\n');
  if (mode !== 'missing-base') await fsp.link(path.join(root, 'release', previous, oldName), path.join(cache, CURRENT_APP_INSTALLER_FILE_NAME));
  let bytes = 0, ranges = 0, full = 0;
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(1));
    let file = name === 'latest.yml' ? path.join(directory, name)
      : name === currentName || name === currentName + '.blockmap' ? path.join(directory, name)
      : name === `PDFSandwich-Setup-${previous}.exe.blockmap` ? path.join(root, 'release', previous, oldName + '.blockmap') : null;
    if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d+)$/);
    if (req.headers.range && !range) { res.writeHead(416); res.end(); return; }
    const start = range ? +range[1] : 0, end = range ? Math.min(+range[2], size - 1) : size - 1;
    if (start > end) { res.writeHead(416); res.end(); return; }
    res.writeHead(range ? 206 : 200, { 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes', ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
    const stream = fs.createReadStream(file, { start, end });
    if (name === currentName) {
      if (range) ranges++; else full++;
      let first = true;
      stream.on('data', chunk => { bytes += chunk.length; if (mode === 'corrupt' && first) { chunk[0] ^= 0xff; first = false; } });
    }
    stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const app = { version: previous, name: 'PDFSandwich-transfer-test', isPackaged: true, appUpdateConfigPath: config, userDataPath: folder, baseCachePath: folder, whenReady: async () => {}, onQuit: () => {}, quit: () => { throw new Error('Test must not quit/install'); } };
  const updater = new NsisUpdater(null, app); updater.httpExecutor = new NodeHttpExecutor();
  // Reuse the production download/checksum implementation with Node HTTP sockets.
  updater.httpExecutor.download = ElectronHttpExecutor.prototype.download;
  updater.setFeedURL({ provider: 'generic', url: `http://127.0.0.1:${server.address().port}/`, useMultipleRangeRequest: false });
  updater.autoDownload = false; updater.autoInstallOnAppQuit = false;
  updater.logger = { info() {}, warn() {}, error() {}, debug() {} };
  try {
    await updater.checkForUpdates();
    if (mode === 'corrupt') {
      await assert.rejects(updater.downloadUpdate(), /sha512|checksum/i);
      assert.equal(updater.installerPath, null);
    } else {
      const [file] = await updater.downloadUpdate();
      assert.equal(await hash(file), expected);
      if (mode === 'delta') { assert.ok(ranges > 0); assert.equal(full, 0); assert.ok(bytes < current.size * .9); }
      else assert.equal(full, 1);
    }
    return { mode, installerBytes: current.size, transferredInstallerBytes: bytes, rangeRequests: ranges, fullDownloads: full, savedPercent: +(100 * (1 - bytes / current.size)).toFixed(1), checksum: mode === 'corrupt' ? 'rejected' : 'matched' };
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
(async () => {
  const result = [];
  for (const mode of ['delta', 'missing-base', 'corrupt']) { const value = await scenario(mode); result.push(value); console.log(JSON.stringify(value)); }
  await fsp.mkdir(path.join(root, 'test-results'), { recursive: true });
  await fsp.writeFile(path.join(root, 'test-results', 'update-transfer.json'), JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
