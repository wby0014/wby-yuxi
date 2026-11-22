'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '../..');
const webRequire = createRequire(path.join(root, 'web/package.json'));

/** 两种桌面构建只读取服务端品牌文件中的产品展示名称。 */
function readProductName(env = process.env) {
  const directory = path.join(root, 'backend/package/yuxi/config/static');
  const configured = env.YUXI_BRAND_FILE_PATH
    ? path.resolve(root, 'backend', env.YUXI_BRAND_FILE_PATH)
    : path.join(directory, 'info.local.yaml');
  const file = fs.existsSync(configured) ? configured : path.join(directory, 'info.template.yaml');
  const config = webRequire('js-yaml').load(fs.readFileSync(file, 'utf8'));
  const name = config?.branding?.name;
  if (typeof name !== 'string' || !name.trim()) throw new Error('品牌配置 branding.name 必须是非空字符串');
  return name.trim();
}

module.exports = { readProductName };
