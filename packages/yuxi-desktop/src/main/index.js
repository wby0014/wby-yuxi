'use strict';

const electron = require('electron');
const { app, protocol } = electron;
const { DesktopApplication } = require('./application');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true,
} }]);

// 开发与测试使用独立目录；正式包固定使用系统分配的 userData。
if (!app.isPackaged && process.env.YUXI_DESKTOP_USER_DATA) app.setPath('userData', process.env.YUXI_DESKTOP_USER_DATA);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let desktop;
  /** 原生入口的异步加载失败需要可见结局。 */
  const restoreMain = () => desktop?.openMainWindow().catch(() => {
    electron.dialog.showErrorBox('无法打开主窗口', '请重新启动客户端');
  });
  app.on('second-instance', restoreMain);
  app.on('activate', restoreMain);
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(async () => {
    desktop = new DesktopApplication(electron, app.getPath('userData'));
    await desktop.start();
  }).catch(() => {
    electron.dialog.showErrorBox('Yuxi 启动失败', '无法读取客户端资源或配置，请重新构建或安装客户端');
    app.quit();
  });
}
