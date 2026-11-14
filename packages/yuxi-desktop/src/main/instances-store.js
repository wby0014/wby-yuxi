'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 读取实例 JSON；缺文件或损坏时返回空（损坏文件先备份）。 */
function loadInstancesFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      instances: Array.isArray(data.instances) ? data.instances : [],
      currentId: data.currentId || null,
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
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { loadInstancesFile, saveInstancesFile };
