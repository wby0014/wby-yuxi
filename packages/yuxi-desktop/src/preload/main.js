'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuxiDesktop', {
  currentInstance: () => ipcRenderer.invoke('instances:current'),
  openSettings: () => ipcRenderer.invoke('app:open-settings'),
  onInstanceChanged: (cb) => {
    const listener = (_e, instance) => cb(instance);
    ipcRenderer.on('instances:changed', listener);
    return () => ipcRenderer.removeListener('instances:changed', listener);
  },
});
