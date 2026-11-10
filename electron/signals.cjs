const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaults = require('./signal-defaults.json');
const ids = new Set(defaults.map(item => item.value));
const fresh = () => ({version:1,slots:structuredClone(defaults)});

function validate(config, nativeImage) {
  if (config?.version !== 1 || !Array.isArray(config.slots) || config.slots.length !== 6) throw new Error('轮盘需要六个方向的表情。');
  const slots = config.slots.map(item => {
    if (!item || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 16 || /[\x00-\x1f]/.test(item.label)) throw new Error('表情名称需为 1–16 个字符。');
    if (typeof item.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error('无效的表情颜色。');
    let value = item.value;
    if (item.kind === 'builtin') {
      if (!ids.has(value)) throw new Error('未知的内置表情。');
    } else if (item.kind === 'emoji') {
      if (typeof value !== 'string' || !value.trim() || value.length > 24 || /[\x00-\x1f<>]/.test(value)) throw new Error('请输入一个简短的 Emoji。');
      value = value.trim();
      if ([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(value)].length !== 1) throw new Error('请每个方向设置一个 Emoji 表情。');
    } else if (item.kind === 'image') {
      if (typeof value !== 'string' || value.length > 360000 || !/^data:image\/png;base64,[a-z0-9+/]+=*$/i.test(value)) throw new Error('图片需先裁剪为 PNG 表情。');
      const bytes = Buffer.from(value.slice(22), 'base64');
      if (bytes.length < 33 || bytes.subarray(0,8).toString('hex') !== '89504e470d0a1a0a' || bytes.toString('ascii',12,16) !== 'IHDR' || bytes.readUInt32BE(16) !== 256 || bytes.readUInt32BE(20) !== 256) throw new Error('图片表情必须为 256 × 256 像素。');
      const decoded = nativeImage.createFromBuffer(bytes);
      if (decoded.isEmpty() || decoded.getSize().width !== 256 || decoded.getSize().height !== 256) throw new Error('图片表情无法读取。');
      value = decoded.toDataURL();
      if (value.length > 360000) throw new Error('图片表情过大。');
    } else throw new Error('未知的表情类型。');
    return {kind:item.kind,value,label:item.label.trim(),color:item.color};
  });
  return {version:1,slots};
}

function createSignalStore(file, nativeImage) {
  return {
    get() {
      if (!fs.existsSync(file)) return fresh();
      if (fs.statSync(file).size > 2400000) throw new Error('表情配置过大，请在轮盘设置中重新保存。');
      return validate(JSON.parse(fs.readFileSync(file,'utf8')), nativeImage);
    },
    save(config) {
      const result = validate(config,nativeImage);
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const temp = file+'.'+crypto.randomUUID()+'.tmp';
      try { fs.writeFileSync(temp,JSON.stringify(result)); fs.renameSync(temp,file); }
      finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
      return result;
    }
  };
}
module.exports={createSignalStore,validate,fresh};
