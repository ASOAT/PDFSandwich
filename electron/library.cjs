const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const text = (value, limit) => String(value ?? '').trim().slice(0, limit);
const canonical = file => path.resolve(file).toLocaleLowerCase('en-US');
class Library {
  constructor(file, defaultRoot = path.join(path.dirname(file),'library-files')) {
    this.file = file;
    this.data = { version: 1, storageRoot: defaultRoot, collections: [], documents: [] };
    if (fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch { throw new Error('文献库数据无法读取，请保留 library.json 并恢复备份。'); }
      if (this.data.version !== 1 || !Array.isArray(this.data.collections) || !Array.isArray(this.data.documents)) throw new Error('文献库数据格式无法识别。');
    }
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2));
    if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.file + '.bak');
    fs.renameSync(temporary, this.file);
  }
  snapshot() {
    return { storageRoot: this.data.storageRoot, collections: this.data.collections, documents: this.data.documents.map(item => ({ ...item, missing: !fs.existsSync(item.path) })) };
  }
  get(id) {
    const item = this.data.documents.find(item => item.id === id);
    if (!item) throw new Error('文献已被移除，请刷新文献库。');
    return item;
  }
  upsert(metadata, { collectionId, opened = false } = {}) {
    if (collectionId && !this.data.collections.some(c => c.id === collectionId)) throw new Error('分类不存在。');
    let item = this.data.documents.find(item => canonical(item.path) === canonical(metadata.path));
    if (!item) {
      item = { id: randomUUID(), path: path.resolve(metadata.path), title: text(metadata.title, 500) || path.basename(metadata.path, '.pdf'), authors: text(metadata.author, 500), year: '', notes: '', tags: [], collections: [], addedAt: Date.now(), lastOpenedAt: 0, translatedPages: 0 };
      this.data.documents.push(item);
    }
    Object.assign(item, { name: path.basename(metadata.path), pages: Array.isArray(metadata.pages) ? metadata.pages.length : metadata.pages, size: metadata.size });
    if (collectionId && !item.collections.includes(collectionId)) item.collections.push(collectionId);
    if (opened) item.lastOpenedAt = Date.now();
    this.save(); return item;
  }
  migrate(recent) {
    if (this.data.migratedRecent) return;
    for (const entry of recent) {
      if (typeof entry.path !== 'string' || path.extname(entry.path).toLowerCase() !== '.pdf') continue;
      const item = this.upsert({ ...entry, size: fs.existsSync(entry.path) ? fs.statSync(entry.path).size : 0 });
      item.lastOpenedAt = entry.openedAt || 0;
    }
    this.data.migratedRecent = true; this.save();
  }
  importCopy(metadata, collectionId) {
    if (collectionId && !this.data.collections.some(c => c.id === collectionId)) throw new Error('分类不存在。');
    const original = canonical(metadata.path);
    let known = this.data.documents.find(item => canonical(item.path) === original || (item.originalPath && canonical(item.originalPath) === original));
    if (known?.managed && fs.existsSync(known.path)) {
      if (collectionId && !known.collections.includes(collectionId)) { known.collections.push(collectionId); this.save(); }
      return known;
    }
    const id = known?.id || randomUUID();
    const folder = path.join(this.data.storageRoot,id);
    const destination = path.join(folder,path.basename(metadata.path));
    fs.mkdirSync(folder,{recursive:true});
    fs.copyFileSync(metadata.path,destination,fs.constants.COPYFILE_EXCL);
    if (known) {
      known.path=destination; known.originalPath=metadata.path; known.managed=true;
      Object.assign(known,{pages:metadata.pages,size:metadata.size});
      if (collectionId && !known.collections.includes(collectionId)) known.collections.push(collectionId);
    } else {
      known=this.upsert({...metadata,path:destination},{collectionId});
      known.id=id; known.originalPath=metadata.path; known.managed=true;
    }
    this.save(); return known;
  }
  setStorageRoot(folder) {
    if (this.data.documents.some(item => item.managed) && canonical(folder)!==canonical(this.data.storageRoot)) throw new Error('已有文件的文献库暂不支持迁移。当前文件位置保持不变。');
    this.data.storageRoot=path.resolve(folder); this.save();
  }
  editDocument(id, changes) {
    const original = this.get(id);
    const item = { ...original };
    for (const [key,limit] of Object.entries({ title:500, authors:500, year:20, notes:10000 })) {
      if (Object.hasOwn(changes,key)) item[key] = text(changes[key],limit);
    }
    if (!item.title) item.title = path.basename(item.path, '.pdf');
    if (changes.tags !== undefined) {
      if (!Array.isArray(changes.tags) || changes.tags.length > 100) throw new Error('每份文献最多 100 个标签。');
      const tags = new Map();
      for (const tag of changes.tags) { const name = text(tag,60); if (name) tags.set(name.toLocaleLowerCase(),name); }
      item.tags = [...tags.values()];
    }
    if (changes.collections !== undefined) {
      if (!Array.isArray(changes.collections) || changes.collections.some(id => !this.data.collections.some(c => c.id === id))) throw new Error('所选分类不存在。');
      item.collections = [...new Set(changes.collections)];
    }
    Object.assign(original,item);
    this.save(); return original;
  }
  collection({ id, name, parentId = null }) {
    name = text(name,100);
    if (!name) throw new Error('请输入分类名称。');
    if (parentId && !this.data.collections.some(c => c.id === parentId)) throw new Error('上级分类不存在。');
    let parent = parentId, depth = 0;
    while (parent) {
      if (parent === id || ++depth > 20) throw new Error('不能将分类移到自身或其子分类中。');
      parent = this.data.collections.find(c => c.id === parent)?.parentId;
    }
    if (this.data.collections.some(c => c.id !== id && c.parentId === parentId && c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error('同一层级已有同名分类。');
    let item = id ? this.data.collections.find(c => c.id === id) : null;
    if (id && !item) throw new Error('分类不存在。');
    if (!item) { item = { id: randomUUID() }; this.data.collections.push(item); }
    Object.assign(item, { name, parentId }); this.save(); return item;
  }
  removeCollection(id) {
    const removed = new Set([id]);
    for (let previous = -1; previous !== removed.size;) {
      previous = removed.size;
      for (const item of this.data.collections) if (removed.has(item.parentId)) removed.add(item.id);
    }
    this.data.collections = this.data.collections.filter(c => !removed.has(c.id));
    for (const item of this.data.documents) item.collections = item.collections.filter(id => !removed.has(id));
    this.save();
  }
  removeDocuments(ids) {
    if (!Array.isArray(ids)) throw new Error('请选择文献。');
    this.data.documents = this.data.documents.filter(item => !ids.includes(item.id)); this.save();
  }
  relocate(id, metadata) {
    const item = this.get(id);
    if (this.data.documents.some(other => other.id !== id && canonical(other.path) === canonical(metadata.path))) throw new Error('该文件已在文献库中。');
    Object.assign(item, { path:path.resolve(metadata.path), name:path.basename(metadata.path), pages:metadata.pages, size:metadata.size, translatedPages:0, managed:false });
    delete item.translationPath; this.save(); return item;
  }
  translation(file, count, output) {
    const item = this.data.documents.find(item => canonical(item.path) === canonical(file));
    if (!item || (item.translatedPages === count && (!output || item.translationPath === output))) return;
    item.translatedPages = count;
    if (output) item.translationPath = output;
    this.save();
  }
}
module.exports = { Library };
