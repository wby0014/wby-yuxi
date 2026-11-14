'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  listInstances: () => ipcRenderer.invoke('instances:list'),
  currentInstance: () => ipcRenderer.invoke('instances:current'),
  addInstance: (name, url) => ipcRenderer.invoke('instances:add', { name, url }),
  removeInstance: (id) => ipcRenderer.invoke('instances:remove', id),
  switchInstance: (id) => ipcRenderer.invoke('instances:switch', id),
});
