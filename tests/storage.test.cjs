const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertWritableDirectory, defaultStorageRoot, isPermissionError } = require('../electron/storage.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfsandwich-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, preferred: path.join(root, 'app', 'Library'), fallback: path.join(root, 'profile', 'Library') };
}
const failure = code => Object.assign(new Error(code), { code });

test('writable directory is checked with create/write/rename/delete and leaves existing files intact', t => {
  const { preferred } = fixture(t), calls = [];
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, 'book.pdf'), 'existing PDF');
  const io = { ...fs };
  for (const method of ['openSync', 'writeFileSync', 'closeSync', 'renameSync', 'unlinkSync']) {
    io[method] = (...args) => { calls.push(method); return fs[method](...args); };
  }
  assert.equal(assertWritableDirectory(preferred, io), path.resolve(preferred));
  assert.deepEqual(calls, ['openSync', 'writeFileSync', 'closeSync', 'openSync', 'closeSync', 'renameSync', 'unlinkSync']);
  assert.deepEqual(fs.readdirSync(preferred), ['book.pdf']);
  assert.equal(fs.readFileSync(path.join(preferred, 'book.pdf'), 'utf8'), 'existing PDF');
});

for (const code of ['EACCES', 'EPERM', 'EROFS']) {
  test(`permission failure ${code} selects the writable per-user directory`, t => {
    const { preferred, fallback } = fixture(t);
    const io = { ...fs, mkdirSync(folder, options) {
      if (folder === preferred) throw failure(code);
      return fs.mkdirSync(folder, options);
    } };
    assert.equal(defaultStorageRoot(preferred, fallback, io), fallback);
    assert.equal(fs.existsSync(preferred), false);
    assert.deepEqual(fs.readdirSync(fallback), []);
  });
}

test('an actual file-write denial falls back even when mkdir is permitted', t => {
  const { preferred, fallback } = fixture(t);
  const io = { ...fs, openSync(file, flags) {
    if (path.dirname(file) === preferred) throw failure('EPERM');
    return fs.openSync(file, flags);
  } };
  assert.equal(defaultStorageRoot(preferred, fallback, io), fallback);
  assert.deepEqual(fs.readdirSync(preferred), []);
});

test('an existing root that denies document subdirectories falls back', t => {
  const { preferred, fallback } = fixture(t);
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, 'keep.pdf'), 'existing document');
  const io = { ...fs, mkdirSync(folder, options) {
    if (path.dirname(folder) === preferred) throw failure('EPERM');
    return fs.mkdirSync(folder, options);
  } };
  assert.equal(defaultStorageRoot(preferred, fallback, io), fallback);
  assert.deepEqual(fs.readdirSync(preferred), ['keep.pdf']);
  assert.deepEqual(fs.readdirSync(fallback), []);
});

test('writable preferred storage stays selected and fallback is not created', t => {
  const { preferred, fallback } = fixture(t);
  assert.equal(defaultStorageRoot(preferred, fallback), preferred);
  assert.equal(fs.existsSync(fallback), false);
});

test('disk full propagates the original failure without switching or leaving probes', t => {
  const { preferred, fallback } = fixture(t), error = failure('ENOSPC');
  const io = { ...fs, writeFileSync() { throw error; } };
  assert.throws(() => defaultStorageRoot(preferred, fallback, io), value => value === error);
  assert.deepEqual(fs.readdirSync(preferred), []);
  assert.equal(fs.existsSync(fallback), false);
});

test('rename denial removes only owned probes and preserves the original error', t => {
  const { preferred } = fixture(t), error = failure('EPERM');
  fs.mkdirSync(preferred, { recursive: true });
  fs.writeFileSync(path.join(preferred, 'keep.txt'), 'keep');
  const io = { ...fs, renameSync() { throw error; } };
  assert.throws(() => assertWritableDirectory(preferred, io), value => value === error);
  assert.deepEqual(fs.readdirSync(preferred), ['keep.txt']);
});

test('a rename-destination collision cannot overwrite or delete an unowned file', t => {
  const { preferred } = fixture(t);
  let collision;
  const io = { ...fs, openSync(file, flags) {
    if (file.endsWith('.renamed')) { collision = file; fs.writeFileSync(file, 'unowned contents'); }
    return fs.openSync(file, flags);
  } };
  assert.throws(() => assertWritableDirectory(preferred, io), { code: 'EEXIST' });
  assert.deepEqual(fs.readdirSync(preferred), [path.basename(collision)]);
  assert.equal(fs.readFileSync(collision, 'utf8'), 'unowned contents');
});

test('cleanup failures do not mask write errors and only owned paths are touched', t => {
  const { preferred } = fixture(t), error = failure('ENOSPC'), removed = [];
  const io = { ...fs, writeFileSync() { throw error; }, unlinkSync(file) { removed.push(file); throw failure('EPERM'); } };
  assert.throws(() => assertWritableDirectory(preferred, io), value => value === error);
  assert.equal(removed.length, 1);
  assert.equal(path.dirname(removed[0]), preferred);
  assert.match(path.basename(removed[0]), /^\.pdfsandwich-write-.*\.tmp$/);
});

test('unwritable fallback propagates its own actionable filesystem error', t => {
  const { preferred, fallback } = fixture(t), first = failure('EPERM'), second = failure('EACCES');
  const io = { ...fs, mkdirSync(folder) { throw folder === preferred ? first : second; } };
  assert.throws(() => defaultStorageRoot(preferred, fallback, io), error => error === second);
  assert.equal(isPermissionError(first), true);
  assert.equal(isPermissionError(failure('ENOSPC')), false);
  assert.equal(isPermissionError(null), false);
});
