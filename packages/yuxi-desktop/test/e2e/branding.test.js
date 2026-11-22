'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');

test('自定义构建名驱动原生菜单、窗口与离线页面，userData 保持原路径', { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-brand-e2e-'));
  const packageDir = path.resolve(__dirname, '../..');
  const fixture = path.join(directory, 'app');
  const userData = path.join(directory, 'existing-user-data');
  const productName = '团队 "知识" & 工作台';
  fs.mkdirSync(path.join(fixture, 'renderer'), { recursive: true });
  fs.cpSync(path.join(packageDir, 'src'), path.join(fixture, 'src'), { recursive: true });
  fs.copyFileSync(path.join(packageDir, 'package.json'), path.join(fixture, 'package.json'));
  fs.symlinkSync(path.join(packageDir, 'renderer/standalone'), path.join(fixture, 'renderer/standalone'), 'dir');
  fs.symlinkSync(path.join(packageDir, 'renderer/__desktop'), path.join(fixture, 'renderer/__desktop'), 'dir');
  const build = JSON.parse(fs.readFileSync(path.join(packageDir, 'renderer/desktop-build.json')));
  fs.writeFileSync(path.join(fixture, 'renderer/desktop-build.json'), JSON.stringify({ ...build, productName }));
  const app = await electron.launch({
    executablePath: require('electron'), args: [fixture],
    env: { ...process.env, YUXI_DESKTOP_USER_DATA: userData }, timeout: 15000,
  });
  t.after(async () => {
    try { await app.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: `欢迎使用 ${productName}`, exact: true }).waitFor();
  assert.equal(await page.title(), `连接 ${productName}`);
  const native = await app.evaluate(({ app, BrowserWindow, Menu }) => ({
    name: app.getName(), userData: app.getPath('userData'),
    titles: BrowserWindow.getAllWindows().map((win) => win.getTitle()),
    menu: Menu.getApplicationMenu().items[0].submenu.items.map((item) => item.label),
  }));
  assert.equal(native.name, productName);
  assert.equal(native.userData, userData);
  assert.ok(native.titles.includes(productName));
  assert.ok(native.titles.includes(`${productName} 实例设置`));
  assert.ok(native.menu.some((label) => label.includes(productName)));
  const settings = (await app.windows()).find((window) => window !== page) || await app.waitForEvent('window');
  await settings.waitForURL('app://yuxi/__desktop/settings');
  await settings.getByText(`添加本地或远程 ${productName} 服务。切换实例需要重新登录。`, { exact: true }).waitFor();
  assert.equal(await settings.title(), `${productName} 实例设置`);
  const screenshots = process.env.YUXI_DESKTOP_ARTIFACT_DIR || path.join(os.tmpdir(), 'yuxi-branding-screenshots');
  fs.mkdirSync(screenshots, { recursive: true });
  await page.screenshot({ path: path.join(screenshots, 'custom-brand-status.png') });
});
