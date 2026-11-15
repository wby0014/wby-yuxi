/** 创建最小平台适配；浏览器仍沿用现有 localStorage 行为。 */
export function createPlatform({ bridge, storage } = {}) {
  const isDesktop = Boolean(bridge)
  let token = ''
  let state = { serverUrl: '', secureStorageAvailable: false }
  const local = () => storage || globalThis.localStorage

  return {
    isDesktop,
    async initializePlatform() {
      if (!isDesktop) return
      const restored = await bridge.getState()
      token = restored.token || ''
      state = { serverUrl: restored.serverUrl, secureStorageAvailable: restored.secureStorageAvailable }
      // 清理该 app origin 遗留的明文 token，永远不回退读取它。
      local()?.removeItem('user_token')
    },
    getDesktopState() { return { ...state } },
    getSessionToken() { return isDesktop ? token : local()?.getItem('user_token') || '' },
    async saveSessionToken(value) {
      if (!isDesktop) {
        if (value) local().setItem('user_token', value)
        else local().removeItem('user_token')
        return
      }
      if (!value) token = ''
      await bridge.setToken(value)
      token = value
    },
    async configureServer(url) {
      if (!isDesktop) throw new Error('当前平台不支持桌面服务设置')
      return bridge.configureServer(url)
    }
  }
}

const platform = createPlatform({ bridge: globalThis.window?.yuxiDesktop })
export const { isDesktop, initializePlatform, getDesktopState, getSessionToken, saveSessionToken, configureServer } = platform
