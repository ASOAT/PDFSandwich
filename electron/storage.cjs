const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const isPermissionError = error => ['EACCES', 'EPERM', 'EROFS'].includes(error?.code);

function assertWritableDirectory(folder, io = fs) {
  const directory = path.resolve(folder);
  io.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.pdfsandwich-write-${randomUUID()}.tmp`);
  const renamed = probe + '.renamed';
  const child = path.join(directory, `.pdfsandwich-dir-${randomUUID()}`);
  const owned = new Set();
  let fd, childCreated = false;
  try {
    // Imports need a new document subdirectory as well as writable files.
    // An existing root can grant these permissions independently on Windows.
    io.mkdirSync(child);
    childCreated = true;
    fd = io.openSync(probe, 'wx');
    owned.add(probe);
    io.writeFileSync(fd, 'PDFSandwich storage permission check');
    io.closeSync(fd); fd = undefined;
    // Reserve the rename destination exclusively too. Even an unexpected
    // filename collision must not overwrite someone else's file.
    fd = io.openSync(renamed, 'wx');
    owned.add(renamed);
    io.closeSync(fd); fd = undefined;
    io.renameSync(probe, renamed);
    owned.delete(probe);
    io.unlinkSync(renamed);
    owned.delete(renamed);
    io.rmdirSync(child);
    childCreated = false;
    return directory;
  } finally {
    // Preserve the original failure and remove only files created above.
    // Never remove the selected directory or recursively clear its contents.
    if (fd !== undefined) { try { io.closeSync(fd); } catch {} }
    for (const file of owned) { try { io.unlinkSync(file); } catch {} }
    if (childCreated) { try { io.rmdirSync(child); } catch {} }
  }
}

function defaultStorageRoot(preferred, fallback, io = fs) {
  try { return assertWritableDirectory(preferred, io); }
  catch (error) {
    if (!isPermissionError(error)) throw error;
    const same = process.platform === 'win32'
      ? path.resolve(preferred).toLowerCase() === path.resolve(fallback).toLowerCase()
      : path.resolve(preferred) === path.resolve(fallback);
    if (same) throw error;
    return assertWritableDirectory(fallback, io);
  }
}

module.exports = { assertWritableDirectory, isPermissionError, defaultStorageRoot };
