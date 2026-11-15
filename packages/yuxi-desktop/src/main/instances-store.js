'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { normalizeUrl } = require('./instances');

/** 读取实例 JSON；缺文件或损坏时返回空（损坏文件先备份）。 */
function loadInstancesFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(data.instances) || data.instances.some((instance) =>
      !instance || typeof instance.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(instance.id) ||
      typeof instance.name !== 'string' || !instance.name.trim() ||
      typeof instance.url !== 'string' || normalizeUrl(instance.url).url !== instance.url) ||
      new Set(data.instances.map((instance) => instance.id)).size !== data.instances.length ||
      new Set(data.instances.map((instance) => instance.url)).size !== data.instances.length) {
      throw new Error('实例配置结构无效');
    }
    return {
      instances: data.instances,
      currentId: data.instances.some((instance) => instance.id === data.currentId)
        ? data.currentId : data.instances[0]?.id || null,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try {
        fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {}
    }
    return { instances: [], currentId: null };
  }
}

/** 原子写回实例 JSON（先写临时文件再 rename）。 */
function saveInstancesFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

module.exports = { loadInstancesFile, saveInstancesFile };
