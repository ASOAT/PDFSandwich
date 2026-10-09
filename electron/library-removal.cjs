const fs = require('node:fs');
const path = require('node:path');

const canonical = file => path.resolve(file).toLowerCase();

// Only registered PDFs in this document's managed directory can be recycled.
// Never remove directories: they may also contain notes, backups or user files.
function removalFiles(library, item) {
  if (!item.managed) return [];
  if (path.basename(item.id) !== item.id || ['.', '..'].includes(item.id)) throw new Error('文献目录无效，未删除文件。');
  const folder = path.join(library.data.storageRoot, item.id);
  const candidates = [...new Set([item.path, item.translationPath].filter(Boolean).map(file => path.resolve(file)))];
  const files = [];
  for (const file of candidates) {
    if (path.extname(file).toLowerCase() !== '.pdf' || canonical(path.dirname(file)) !== canonical(folder) ||
        (item.originalPath && canonical(file) === canonical(item.originalPath))) {
      throw new Error('PDF 不在此文献的库内目录中，未删除文件。可取消勾选“同时删除 PDF”后移除记录。');
    }
    // Check directory links even when the PDF is already missing (retry case).
    if (fs.existsSync(folder)) {
      if (fs.lstatSync(folder).isSymbolicLink() || canonical(fs.realpathSync(folder)) !== canonical(path.join(fs.realpathSync(library.data.storageRoot), item.id))) {
        throw new Error('文献目录已重定向，未删除文件。');
      }
    }
    let stat;
    try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('文献文件类型异常，未删除文件。');
    files.push(file);
  }
  // Remove the source last so a failed translation deletion leaves it available.
  return files.sort((a, b) => Number(canonical(a) === canonical(item.path)) - Number(canonical(b) === canonical(item.path)));
}

async function removeLibraryDocuments(library, { ids, deletePdf = false }, { trash, beforeTrash = async () => {} } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string')) throw new Error('请选择文献。');
  const removed = [], errors = [];
  for (const id of new Set(ids)) {
    const item = library.data.documents.find(entry => entry.id === id);
    if (!item) continue; // Retrying an already completed batch is harmless.
    let recycled = 0;
    try {
      if (deletePdf === true && item.managed) {
        removalFiles(library, item); // Validate before closing an open reader.
        await beforeTrash(item);
        // An in-flight automatic save may have registered a new translation.
        for (const file of removalFiles(library, item)) { await trash(file); recycled++; }
      }
      library.removeDocuments([id]);
      removed.push(id);
    } catch (error) {
      errors.push({ id, name: item.title || item.name, error: `${recycled ? '部分 PDF 已移至回收站；' : ''}未移除文献记录：${error.message}` });
    }
  }
  return { ...library.snapshot(), removed, errors };
}

module.exports = { removeLibraryDocuments, removalFiles };
