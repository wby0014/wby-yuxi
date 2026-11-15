import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, protocol, safeStorage, session, shell } from 'electron'
import { basename, join } from 'node:path'
import { APP_ORIGIN, isExternalUrl, isTrustedSender, isTrustedUiUrl, normalizeServerUrl } from './policy.ts'
import { ProfileStore } from './profile.ts'
import { createGateway } from './gateway.ts'
import { CHANNELS } from './contracts.ts'

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
} }])

let window: BrowserWindow | null = null
let switching = false
let profile: ProfileStore
let gateway: ReturnType<typeof createGateway>

/** 外链需要用户确认，且绝不交给 shell 处理危险协议。 */
async function openExternal(url: string): Promise<void> {
  if (!isExternalUrl(url) || !window || window.isDestroyed()) return
  const host = new URL(url).host
  const choice = await dialog.showMessageBox(window, {
    type: 'question', message: '在系统浏览器中打开外部链接？',
    detail: `目标站点：${host}`, buttons: ['取消', '打开'], defaultId: 0, cancelId: 0
  })
  if (choice.response === 1) {
    try { await shell.openExternal(url) } catch { dialog.showErrorBox('无法打开链接', '请检查系统默认浏览器设置') }
  }
}

/** 只装配可信本地页面；业务 HTTP 永远留在受限协议网关内。 */
function createWindow(): void {
  const current = new BrowserWindow({
    width: 1440, height: 960, minWidth: 960, minHeight: 640, show: false,
    title: '语析 Yuxi', backgroundColor: nativeTheme.shouldUseDarkColors ? '#181818' : '#fafafa',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'), nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false
    }
  })
  window = current
  current.once('ready-to-show', () => current.show())
  current.on('closed', () => { if (window === current) window = null })
  current.webContents.on('will-attach-webview', (event) => event.preventDefault())
  current.webContents.setWindowOpenHandler(({ url }) => { void openExternal(url); return { action: 'deny' } })
  current.webContents.on('will-navigate', (event) => {
    if (isTrustedUiUrl(event.url)) return
    event.preventDefault()
    void openExternal(event.url)
  })
  current.webContents.on('will-redirect', (event) => {
    if (!isTrustedUiUrl(event.url)) event.preventDefault()
  })
  // 不允许 iframe 把远程服务内容升级为应用页面。
  current.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame && event.url.startsWith(APP_ORIGIN)) event.preventDefault()
  })
  void current.loadURL(APP_ORIGIN + '/').catch(() => {
    if (!current.isDestroyed()) dialog.showErrorBox('页面加载失败', '请重新启动客户端或重新安装完整安装包')
  })
}

/** 会话写入与服务切换只接收当前主窗口 main frame 的调用。 */
function registerIpc(): void {
  ipcMain.handle(CHANNELS.state, (event) => {
    if (!window || !isTrustedSender(event, window.webContents)) throw new Error('调用未授权')
    return profile.getState()
  })
  ipcMain.handle(CHANNELS.token, (event, token: unknown) => {
    if (!window || !isTrustedSender(event, window.webContents)) throw new Error('调用未授权')
    try { profile.setToken(token) } catch { throw new Error('登录状态保存失败，请检查系统安全存储及磁盘权限') }
  })
  ipcMain.handle(CHANNELS.server, async (event, value: unknown) => {
    if (!window || !isTrustedSender(event, window.webContents) || switching) throw new Error('调用未授权')
    const serverUrl = normalizeServerUrl(value)
    if (serverUrl === profile.getState().serverUrl) return false
    const oldWindow = window
    switching = true
    try {
      if (profile.getState().serverUrl) {
        const choice = await dialog.showMessageBox(oldWindow, {
          type: 'warning', message: '切换 Yuxi 服务？',
          detail: '将退出当前账号，并清除本客户端的缓存与本地草稿。远程服务数据不受影响。',
          buttons: ['取消', '切换并退出登录'], defaultId: 0, cancelId: 0
        })
        if (choice.response !== 1) return false
      }
      // 发布新服务前先终止旧 renderer，防止旧 token 随并发请求发往新服务。
      oldWindow.destroy()
      gateway.abortAll()
      if (profile.getState().serverUrl) profile.setToken('')
      await session.defaultSession.clearStorageData()
      await session.defaultSession.clearCache()
      profile.setServer(serverUrl)
      createWindow()
      return true
    } catch {
      dialog.showErrorBox('服务设置失败', '无法安全保存服务配置，请检查磁盘权限并重试')
      if (!window || window.isDestroyed()) createWindow()
      return false
    } finally { switching = false }
  })
}

/** 原生菜单只提供应用操作，不提供 shell 或用户目录访问。 */
function installMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '文件', submenu: [{ role: 'close' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '视图', submenu: [
      { role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools' as const }] : [])
    ] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] }
  ]))
}

app.setName('Yuxi')
app.setAppUserModelId('com.yuxi.desktop')

app.whenReady().then(() => {
  try { profile = new ProfileStore(app.getPath('userData'), safeStorage) } catch {
    dialog.showErrorBox('无法读取客户端配置', '配置文件损坏或不可读。请备份并移除应用配置文件后重新启动；远程数据不受影响。')
    app.quit()
    return
  }
  const developmentUrl = !app.isPackaged && process.env.YUXI_DESKTOP_DEV_URL === 'http://127.0.0.1:5173'
    ? process.env.YUXI_DESKTOP_DEV_URL : undefined
  gateway = createGateway({ assetRoot: join(__dirname, '../web-dist'), getServerUrl: () => profile.getState().serverUrl, developmentUrl })
  protocol.handle('app', gateway)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.on('will-download', (event, item) => {
    const url = item.getURL()
    if (!url.startsWith(APP_ORIGIN + '/') && !url.startsWith('blob:' + APP_ORIGIN + '/')) {
      event.preventDefault()
      return
    }
    item.setSaveDialogOptions({ title: '保存下载文件', defaultPath: basename(item.getFilename()) })
  })
  registerIpc()
  installMenu()
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && !switching) createWindow() })
}).catch(() => {
  dialog.showErrorBox('客户端启动失败', '请检查安装包完整性与应用配置目录权限')
  app.quit()
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin' && !switching) app.quit() })
app.on('before-quit', () => gateway?.abortAll())
