'use strict';

const {
  app, BrowserWindow, protocol, net, ipcMain, Menu, dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { createInstancesRepo, validateInstance } = require('./instances');
const { loadInstancesFile, saveInstancesFile } = require('./instances-store');
const { routeRequest } = require('./protocol');
const { openSettingsWindow } = require('./settings-window');
const { buildMenu } = require('./menu');
const { forwardHeaders } = require('./headers');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let mainWindow = null;
let repo = null;
let instancesFile = null;
let rendererDir = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.map': 'application/json',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function persist() {
  saveInstancesFile(instancesFile, repo.snapshot());
}

function currentInstanceUrl() {
  const cur = repo.current();
  return cur ? cur.url : 'http://127.0.0.1:1'; // 无实例时的占位，转发必然失败并返回 502
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const u = new URL(request.url);
    const decision = routeRequest(u.pathname, u.search, {
      instanceUrl: currentInstanceUrl(),
      rendererDir,
    });

    if (decision.action === 'forward') {
      const init = { method: request.method, headers: forwardHeaders(request.headers) };
      if (request.body) {
        init.body = request.body;
        init.duplex = 'half'; // 流式请求体（fetch 规范要求）
      }
      try {
        return await net.fetch(decision.url, init);
      } catch (err) {
        return new Response(
          JSON.stringify({ detail: `无法连接实例: ${err.message}` }),
          { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
    }

    try {
      const data = fs.readFileSync(decision.filePath);
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mimeFor(decision.filePath), 'Cache-Control': 'no-cache' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function switchInstance(id) {
  if (!repo.setCurrent(id)) return { error: '实例不存在' };
  persist();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.session.clearStorageData({ storages: ['localstorage'] });
    mainWindow.webContents.send('instances:changed', repo.current());
    mainWindow.webContents.reload();
  }
  rebuildMenu();
  return { instance: repo.current() };
}

function registerIpc() {
  ipcMain.handle('instances:list', () => repo.list());
  ipcMain.handle('instances:current', () => repo.current());
  ipcMain.handle('instances:add', (_e, { name, url }) => {
    const r = validateInstance({ name, url });
    if (r.error) return { error: r.error };
    const wasEmpty = repo.current() === null;
    repo.add(r.instance);
    persist();
    rebuildMenu();
    // 首次添加实例：主窗口此前停在「无实例」的失败态，需 reload 重新加载 Vue。
    if (wasEmpty && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
    return { instance: r.instance };
  });
  ipcMain.handle('instances:remove', (_e, id) => {
    const removed = repo.remove(id);
    persist();
    rebuildMenu();
    return { ok: removed };
  });
  ipcMain.handle('instances:switch', (_e, id) => switchInstance(id));
  ipcMain.handle('app:open-settings', () => { openSettingsWindow(); return { ok: true }; });
}

function rebuildMenu() {
  Menu.setApplicationMenu(
    buildMenu({
      repo,
      onOpenSettings: () => openSettingsWindow(),
      onSwitchInstance: (id) => switchInstance(id),
    })
  );
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/main.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadURL('app://yuxi/index.html');
}

app.whenReady().then(() => {
  rendererDir = path.join(__dirname, '../../renderer');
  instancesFile = path.join(app.getPath('userData'), 'instances.json');
  repo = createInstancesRepo(loadInstancesFile(instancesFile));

  registerProtocol();
  registerIpc();
  rebuildMenu();
  createMainWindow();

  if (repo.list().length === 0) {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: '欢迎使用 Yuxi Desktop',
        message: '请先配置一个 Yuxi 实例',
        buttons: ['打开设置'],
      })
      .then(() => openSettingsWindow());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
