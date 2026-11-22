'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readProductName } = require('./brand-config.cjs');

/** 从同一 Web 源码构建到指定宿主目录，构建之间不共享可写产物。 */
function buildRenderer(packageDir, runtime) {
  const root = path.resolve(__dirname, '../..');
  const web = path.join(root, 'web');
  const output = path.join(packageDir, 'renderer');
  const desktop = require(path.join(packageDir, 'package.json'));
  const frontend = require(path.join(web, 'package.json'));
  const productName = readProductName();
  execFileSync(process.execPath, [path.join(web, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output, '--emptyOutDir'], {
    cwd: web, stdio: 'inherit',
  });
  const local = path.join(output, '__desktop');
  fs.mkdirSync(local, { recursive: true });
  for (const [source, target] of [
    ['settings/index.html', 'settings.html'], ['settings/settings.js', 'settings.js'],
    ['settings/style.css', 'style.css'], ['settings/theme.js', 'theme.js'],
    ['status/index.html', 'status.html'], ['status/status.js', 'status.js'],
  ]) fs.copyFileSync(path.join(web, 'desktop', source), path.join(local, target));
  fs.cpSync(path.join(web, 'src/platform'), path.join(local, 'platform'), { recursive: true });
  fs.mkdirSync(path.join(output, 'standalone'), { recursive: true });
  for (const file of ['base.css', 'base.dark.css']) {
    fs.copyFileSync(path.join(web, 'src/assets/css', file), path.join(output, 'standalone', file));
  }
  const build = {
    desktopVersion: desktop.version, webVersion: frontend.version,
    productName: runtime === 'tauri' ? `${productName} Tauri` : productName,
    runtime,
  };
  fs.writeFileSync(path.join(output, 'desktop-build.json'), JSON.stringify(build, null, 2) + '\n');
  return build;
}

module.exports = { buildRenderer };
