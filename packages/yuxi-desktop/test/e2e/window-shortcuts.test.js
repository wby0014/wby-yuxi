'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { _electron: electron } = require('playwright-core');
const { productName } = require('../../renderer/desktop-build.json');

test('原生菜单绑定 Cmd+W/M，窗口最小化或关闭后可恢复', { timeout: 30000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-window-shortcuts-'));
  const app = await electron.launch({
    executablePath: require('electron'), args: [path.resolve(__dirname, '../..')],
    env: { ...process.env, YUXI_DESKTOP_USER_DATA: directory }, timeout: 15000,
  });
  t.after(async () => {
    try { await app.close(); } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: `欢迎使用 ${productName}` }).waitFor();
  const bindings = await app.evaluate(({ Menu }) => {
    const collect = (menu) => menu.items.flatMap((item) => [item, ...(item.submenu ? collect(item.submenu) : [])]);
    return collect(Menu.getApplicationMenu()).filter((item) => ['close', 'minimize'].includes(item.role))
      .map((item) => ({ role: item.role, accelerator: item.accelerator, enabled: item.enabled }));
  });
  assert.deepEqual(bindings, [
    { role: 'close', accelerator: 'CommandOrControl+W', enabled: true },
    { role: 'minimize', accelerator: 'CommandOrControl+M', enabled: true },
  ]);
  // CDP 键盘事件只送到页面；分别读取真实菜单绑定和原生窗口结果。
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/status'));
    return new Promise((resolve) => { win.once('minimize', resolve); win.minimize(); });
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/status')).isMinimized()), true);
  await app.evaluate(({ app, BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/status'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Dock 激活没有恢复最小化窗口')), 3000);
      win.once('restore', () => { clearTimeout(timer); resolve(); });
      app.emit('activate');
    });
  });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/status')).isMinimized()), false);
  const closed = page.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/status')).close());
  await closed;
  const restored = app.waitForEvent('window');
  await app.evaluate(({ app }) => app.emit('activate'));
  await (await restored).getByRole('heading', { name: `欢迎使用 ${productName}` }).waitFor();
});
