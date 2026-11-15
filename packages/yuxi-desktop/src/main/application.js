'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { createInstancesRepo, validateInstance } = require('./instances');
const { loadInstancesFile, saveInstancesFile } = require('./instances-store');
const { createProtocolHandler } = require('./protocol');
const { buildMenu } = require('./menu');
const { isAppUrl, externalUrl, assertSender } = require('./security');
const { authorizeOIDC } = require('./oidc');
const { windowBounds } = require('./window-state');

/** 拥有桌面窗口、实例变更、会话隔离与受信 IPC。 */
class DesktopApplication {
  constructor(electron, userData) {
    this.electron = electron;
    this.userData = userData;
    this.rendererDir = path.join(__dirname, '../../renderer');
    this.instancesFile = path.join(userData, 'instances.json');
    this.boundsFile = path.join(userData, 'window.json');
    this.settingsUrl = 'app://yuxi/__desktop/settings';
    this.mainWindow = null;
    this.settingsWindow = null;
    this.changes = Promise.resolve();
    this.status = { message: '请先添加一个 Yuxi 实例' };
  }

  /** 从持久配置装配原生入口与主窗口。 */
  async start() {
    this.repo = createInstancesRepo(loadInstancesFile(this.instancesFile));
    this.build = JSON.parse(fs.readFileSync(path.join(this.rendererDir, 'desktop-build.json'), 'utf8'));
    this.electron.session.fromPartition('yuxi-settings').protocol.handle('app', createProtocolHandler({
      rendererDir: this.rendererDir, instance: null,
    }));
    this.registerIpc();
    this.refreshMenus();
    await this.openMainWindow();
    if (!this.repo.current()) this.openSettings();
  }

  /** 串行提交实例变化；旧窗口销毁后才允许改变目标地址。 */
  changeInstances(operation) {
    const change = this.changes.catch(() => {}).then(async () => {
      const next = createInstancesRepo(this.repo.snapshot());
      const result = operation(next);
      const before = this.repo.current();
      const after = next.current();
      const changed = before?.id !== after?.id || before?.url !== after?.url;
      try {
        if (changed) {
          await this.closeMainWindow();
          if (before) await this.clearInstanceSession(before);
          if (after && after.id !== before?.id) await this.clearInstanceSession(after);
        }
        this.persistInstances(next.snapshot());
      } catch (error) {
        if (changed) await this.ensureMainWindow().catch(() => {});
        throw error;
      }
      this.repo = next;
      this.refreshMenus();
      this.notifySettings();
      if (changed) await this.ensureMainWindow();
      else {
        this.boundInstance = after;
        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.setTitle(this.windowTitle());
      }
      return result;
    });
    this.changes = change;
    return change;
  }

  /** 保存完整实例快照，写入失败时不发布内存目标。 */
  persistInstances(snapshot) { saveInstancesFile(this.instancesFile, snapshot); }

  /** 每个实例使用独立持久会话，旧版共享存储不会被复用。 */
  instanceSession(instance) {
    return this.electron.session.fromPartition(instance ? `persist:yuxi-${instance.id}` : 'yuxi-setup');
  }

  /** 切换时清理 cookie、localStorage、缓存与授权状态。 */
  async clearInstanceSession(instance) {
    const session = this.instanceSession(instance);
    await session.clearStorageData();
    await session.clearCache();
  }

  /** 原生恢复入口与实例变更共用队列，避免清理期间重建旧窗口。 */
  openMainWindow() {
    const opening = this.changes.catch(() => {}).then(() => this.ensureMainWindow());
    this.changes = opening;
    return opening;
  }

  /** 在串行队列内创建绑定固定实例地址的窗口及协议处理器。 */
  async ensureMainWindow() {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.show();
      this.mainWindow.focus();
      return;
    }
    const { BrowserWindow, screen } = this.electron;
    const instance = this.repo.current();
    const session = this.instanceSession(instance);
    const controller = new AbortController();
    if (await session.protocol.isProtocolHandled('app')) session.protocol.unhandle('app');
    session.protocol.handle('app', createProtocolHandler({
      rendererDir: this.rendererDir, instance, signal: controller.signal,
      fetch: (url, init) => session.fetch(url, init),
    }));
    session.setPermissionRequestHandler((contents, permission, callback) => {
      callback(contents === this.mainWindow?.webContents && permission === 'clipboard-sanitized-write' && isAppUrl(contents.getURL()));
    });
    session.setPermissionCheckHandler((contents, permission, origin) =>
      contents === this.mainWindow?.webContents && permission === 'clipboard-sanitized-write' && isAppUrl(origin));
    const win = new BrowserWindow({
      ...windowBounds(this.boundsFile, screen.getAllDisplays()),
      title: this.windowTitle(), minWidth: 720, minHeight: 480,
      webPreferences: {
        session, preload: path.join(__dirname, '../preload/main.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    this.mainWindow = win;
    this.mainController = controller;
    this.boundInstance = instance;
    win.on('page-title-updated', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(({ url }) => {
      this.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
    /** 主窗口保留本地导航，外部顶层链接交系统浏览器。 */
    const navigate = (event) => {
      if (isAppUrl(event.url)) return;
      event.preventDefault();
      if (event.isMainFrame !== false) this.openExternal(event.url).catch(() => {});
    };
    win.webContents.on('will-frame-navigate', navigate);
    win.webContents.on('will-redirect', navigate);
    win.webContents.on('render-process-gone', () => {
      this.status = { message: '页面进程已退出，请重新连接' };
      win.loadURL('app://yuxi/__desktop/status').catch(() => {});
    });
    win.on('close', () => this.saveBounds(win));
    win.on('closed', () => {
      controller.abort();
      if (this.mainWindow === win) this.mainWindow = null;
    });
    await this.showMainContent(win, instance, controller.signal);
  }

  /** 保存位置后销毁旧页面，阻止其继续生成请求。 */
  async closeMainWindow() {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) return;
    this.saveBounds(win);
    this.mainController.abort();
    win.destroy();
    this.mainWindow = null;
  }

  /** 检查接流量条件，失败时显示可重试的本地页面。 */
  async showMainContent(win, instance, signal) {
    const result = instance ? await this.checkConnection(instance.url, signal) : { ok: false, message: '请先添加一个 Yuxi 实例' };
    if (win.isDestroyed() || signal.aborted) return;
    this.status = result;
    await win.loadURL(result.ok ? 'app://yuxi/' : 'app://yuxi/__desktop/status');
  }

  /** 连接测试访问真实 readiness，并核对打包界面版本。 */
  async checkConnection(url, signal = new AbortController().signal) {
    const result = validateInstance({ name: '连接测试', url });
    if (result.error) return { ok: false, message: result.error };
    try {
      const response = await this.electron.net.fetch(`${result.instance.url}/api/system/ready`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), redirect: 'error', credentials: 'omit',
      });
      const data = await response.json();
      if (!response.ok || data.status !== 'ready') return { ok: false, message: '实例尚未就绪，请检查服务端状态后重试' };
      if (this.build && data.version !== this.build.webVersion) {
        return { ok: false, message: `客户端界面版本 ${this.build.webVersion} 与实例版本 ${data.version || '未知'} 不一致，请更新客户端或实例` };
      }
      return { ok: true, message: `连接正常 · 服务端 ${data.version}`, version: data.version };
    } catch {
      return { ok: false, message: '连接失败，请检查地址、网络、证书与服务状态' };
    }
  }

  /** 设置窗口只保留一个实例，使用独立本地页面。 */
  openSettings() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.show();
      this.settingsWindow.focus();
      return;
    }
    const win = new this.electron.BrowserWindow({
      width: 680, height: 650, minWidth: 520, minHeight: 480, title: 'Yuxi 实例设置',
      webPreferences: {
        partition: 'yuxi-settings', preload: path.join(__dirname, '../preload/settings.js'),
        contextIsolation: true, sandbox: true, nodeIntegration: false,
      },
    });
    this.settingsWindow = win;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-frame-navigate', (event) => { if (event.url !== this.settingsUrl) event.preventDefault(); });
    win.on('closed', () => { this.settingsWindow = null; });
    win.loadURL(this.settingsUrl).catch(() => this.electron.dialog.showErrorBox('无法打开设置', '请重新安装客户端'));
  }

  /** 仅打开受限的网页外链。 */
  openExternal(url) { return this.electron.shell.openExternal(externalUrl(url)); }

  /** 原生标题显示当前实例，避免跨环境误操作。 */
  windowTitle() { return `Yuxi Desktop${this.repo.current() ? ` · ${this.repo.current().name}` : ''}`; }

  /** 重新生成实例菜单与主窗口入口。 */
  refreshMenus() {
    this.electron.Menu.setApplicationMenu(buildMenu({
      Menu: this.electron.Menu, repo: this.repo,
      onOpenSettings: () => this.openSettings(), onOpenMain: () => this.openMainWindow().catch(() => {
        this.electron.dialog.showErrorBox('无法打开主窗口', '请重新启动客户端');
      }),
      onSwitchInstance: (id) => this.changeInstances((repo) => repo.setCurrent(id)).catch(() => {
        this.electron.dialog.showErrorBox('切换失败', '无法保存或清理实例状态，请打开设置重试');
      }),
    }));
  }

  /** 将原生入口的实例变化投影到设置页。 */
  notifySettings() {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) this.settingsWindow.webContents.send('instances:changed');
  }

  /** 只保存正常窗口位置，不写入业务内容。 */
  saveBounds(win) {
    try { fs.writeFileSync(this.boundsFile, JSON.stringify(win.getNormalBounds()) + '\n', { mode: 0o600 }); } catch {
      // 位置保存失败不阻止关闭，业务与实例状态由各自持久层拥有。
    }
  }

  /** 在 IPC 副作用前验证窗口身份与顶层 frame。 */
  registerIpc() {
    const { ipcMain, BrowserWindow } = this.electron;
    const handle = (channel, owner, callback) => ipcMain.handle(channel, async (event, ...args) => {
      try {
        const settings = owner === 'settings';
        assertSender(event, settings ? this.settingsWindow : this.mainWindow,
          settings ? (url) => url === this.settingsUrl : isAppUrl);
        return await callback(...args);
      } catch (error) { return { error: error.message }; }
    });
    handle('instances:list', 'settings', () => this.repo.list());
    handle('instances:current', 'main', () => this.boundInstance);
    handle('instances:state', 'settings', () => ({ ...this.repo.snapshot(), build: this.build }));
    handle('instances:add', 'settings', (input) => this.changeInstances((repo) => {
      const result = validateInstance(input || {});
      if (result.error) throw new Error(result.error);
      return repo.add(result.instance);
    }));
    handle('instances:update', 'settings', ({ id, name, url } = {}) => this.changeInstances((repo) => repo.update(id, { name, url })));
    handle('instances:remove', 'settings', (id) => this.changeInstances((repo) => repo.remove(id)));
    handle('instances:switch', 'settings', (id) => this.changeInstances((repo) => repo.setCurrent(id)));
    handle('instances:check', 'settings', (url) => this.checkConnection(url));
    handle('app:open-settings', 'main', () => { this.openSettings(); return { ok: true }; });
    handle('app:open-external', 'main', (url) => this.openExternal(url));
    handle('app:status', 'main', () => ({ ...this.status, instance: this.boundInstance, build: this.build }));
    handle('app:retry', 'main', () => this.showMainContent(this.mainWindow, this.boundInstance, this.mainController.signal));
    handle('app:oidc', 'main', async () => {
      if (!this.boundInstance) throw new Error('请先配置实例');
      if (this.authorizing) throw new Error('已有登录窗口，请先完成或关闭');
      this.authorizing = true;
      try {
        return await authorizeOIDC({ BrowserWindow, parent: this.mainWindow, instance: this.boundInstance,
          fetch: (url, init) => this.instanceSession(this.boundInstance).fetch(url, init), signal: this.mainController.signal });
      } finally { this.authorizing = false; }
    });
  }
}

module.exports = { DesktopApplication };
