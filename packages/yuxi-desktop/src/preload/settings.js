'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** 仅封装设置页已经授权的实例操作。 */
async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (result?.error) throw new Error(result.error);
  return result;
}

contextBridge.exposeInMainWorld('settingsAPI', {
  state: () => invoke('instances:state'),
  addInstance: (name, url) => invoke('instances:add', { name, url }),
  updateInstance: (id, name, url) => invoke('instances:update', { id, name, url }),
  removeInstance: (id) => invoke('instances:remove', id),
  switchInstance: (id) => invoke('instances:switch', id),
  checkConnection: (url) => invoke('instances:check', url),
  onChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('instances:changed', listener);
    return () => ipcRenderer.removeListener('instances:changed', listener);
  },
});
