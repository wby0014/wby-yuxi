import { electronDesktop } from './electron.js'
import { tauriDesktop, tauriSettings } from './tauri.js'
import { nativeStreamFetch } from './stream.js'

/** 宿主检测集中在边界，网页业务只消费实际存在的桌面能力。 */
export function getDesktop() {
  const host = globalThis.window
  if (host?.yuxiDesktop) return electronDesktop(host.yuxiDesktop)
  if (host?.__TAURI__?.core) return tauriDesktop(host.__TAURI__.core)
  return null
}

/** 设置页复用展示逻辑，各宿主分别执行实例副作用。 */
export function getDesktopSettings() {
  const host = globalThis.window
  if (host?.settingsAPI) return host.settingsAPI
  if (host?.__TAURI__?.core) return tauriSettings(host.__TAURI__)
  throw new Error('实例设置需要桌面客户端')
}

/** Tauri 业务请求统一经原生传输编码上传、取消请求和增量读取响应。 */
export function platformFetch(path, options = {}) {
  const core = globalThis.window?.__TAURI__?.core
  if (core) {
    return nativeStreamFetch(core, path, options)
  }
  return globalThis.fetch(path, options)
}
