'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 统一暴露可展示错误，不让渲染层访问任意 IPC。 */
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result?.error) throw new Error(result.error);
  return result;
}

contextBridge.exposeInMainWorld('yuxiDesktop', {
  currentInstance: () => invoke('instances:current'),
  openSettings: () => invoke('app:open-settings'),
  openExternal: (url) => invoke('app:open-external', url),
  authorizeOIDC: () => invoke('app:oidc'),
  status: () => invoke('app:status'),
  retry: () => invoke('app:retry'),
  onInstanceChanged: (cb) => {
    const listener = (_e, instance) => cb(instance);
    ipcRenderer.on('instances:changed', listener);
    return () => ipcRenderer.removeListener('instances:changed', listener);
  },
});
