'use strict';

const crypto = require('node:crypto');
const { externalUrl } = require('./security');

/** 在无特权的独立窗口完成授权，只交回当前实例的一次性登录码。 */
async function authorizeOIDC({ BrowserWindow, parent, instance, fetch, signal }) {
  const response = await fetch(`${instance.url}/api/auth/oidc/login-url`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), redirect: 'error',
  });
  if (!response.ok) throw new Error('无法获取登录地址，请检查实例的 OIDC 配置');
  const data = await response.json();
  const loginUrl = externalUrl(data.login_url);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      parent, width: 560, height: 760, title: 'Yuxi 账户登录',
      webPreferences: { partition: `oidc-${crypto.randomUUID()}`, contextIsolation: true, sandbox: true, nodeIntegration: false },
    });
    let finished = false;
    const timeout = setTimeout(() => finish(new Error('登录超时，请重新发起登录')), 300000);
    /** 完成一次授权并释放窗口及取消监听。 */
    function finish(error, code) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (!win.isDestroyed()) win.destroy();
      if (error) reject(error); else resolve({ code });
    }
    /** 实例切换或主窗口关闭时取消授权。 */
    function abort() { finish(new Error('登录已取消')); }
    /** 在远端页面加载前截获当前实例回调，拒绝非网页导航。 */
    function navigate(event) {
      let url;
      try { url = new URL(externalUrl(event.url)); } catch { event.preventDefault(); return; }
      if (event.isMainFrame === false || url.origin !== instance.url) return;
      if (url.pathname === '/auth/oidc/callback') {
        event.preventDefault();
        const code = url.searchParams.get('code');
        if (!code || !/^[A-Za-z0-9_-]{16,512}$/.test(code)) finish(new Error('登录回调缺少有效授权码'));
        else finish(null, code);
      } else if (url.pathname === '/login' && url.searchParams.has('oidc_error')) {
        event.preventDefault();
        finish(new Error('身份认证失败，请重试或联系管理员'));
      }
    }
    win.webContents.on('will-frame-navigate', navigate);
    win.webContents.on('will-redirect', navigate);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.on('closed', () => finish(new Error('登录已取消')));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    else win.loadURL(loginUrl).catch(() => finish(new Error('无法打开登录页面，请检查网络')));
  });
}

module.exports = { authorizeOIDC };
