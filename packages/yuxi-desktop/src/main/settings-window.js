'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

/** 打开实例设置窗口（本地文件加载，独立 preload）。 */
function openSettingsWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 460,
    title: 'Yuxi 实例设置',
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../settings/index.html'));
  return win;
}

module.exports = { openSettingsWindow };
