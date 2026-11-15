import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from './contracts.ts'
import type { DesktopBridge } from './contracts.ts'

// 子 frame 永远没有 bridge；main 仍逐次校验 sender，不能只依赖此条件。
if (process.isMainFrame) {
  const bridge: DesktopBridge = {
    getState: () => ipcRenderer.invoke(CHANNELS.state),
    configureServer: (url) => ipcRenderer.invoke(CHANNELS.server, url),
    setToken: (token) => ipcRenderer.invoke(CHANNELS.token, token)
  }
  contextBridge.exposeInMainWorld('yuxiDesktop', Object.freeze(bridge))
}
