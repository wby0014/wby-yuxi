/** 把 Electron preload 限定为业务页面使用的桌面接口。 */
export function electronDesktop(bridge) {
  return {
    currentInstance: () => bridge.currentInstance(),
    openSettings: () => bridge.openSettings(),
    openExternal: (url) => bridge.openExternal(url),
    authorizeOIDC: () => bridge.authorizeOIDC(),
    status: () => bridge.status(),
    retry: () => bridge.retry()
  }
}
