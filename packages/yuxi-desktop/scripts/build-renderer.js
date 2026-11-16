'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readProductName } = require('./brand-config');

const root = path.resolve(__dirname, '../../..');
const web = path.join(root, 'web');
const output = path.resolve(__dirname, '../renderer');
const desktop = require('../package.json');
const frontend = require(path.join(web, 'package.json'));
const productName = readProductName();

execFileSync(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: web, stdio: 'inherit' });
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(web, 'dist'), output, { recursive: true });
fs.mkdirSync(path.join(output, 'standalone'), { recursive: true });
for (const file of ['base.css', 'base.dark.css']) {
  fs.copyFileSync(path.join(web, 'src/assets/css', file), path.join(output, 'standalone', file));
}
fs.writeFileSync(path.join(output, 'desktop-build.json'), JSON.stringify({
  desktopVersion: desktop.version, webVersion: frontend.version, productName,
}, null, 2) + '\n');
console.log(`桌面界面构建完成：Web ${frontend.version} / Desktop ${desktop.version}`);
