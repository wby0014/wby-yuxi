/** 原生 Result 的字符串错误统一转为页面可展示的 Error。 */
async function invoke(core, command, arguments_) {
  try { return await core.invoke(command, arguments_) } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/** 只暴露原生端定义的桌面动作，调用方不传入任意命令名。 */
export function tauriDesktop(core) {
  const main = (type, values = {}) => invoke(core, 'desktop_main', { operation: { type, ...values } })
  return {
    currentInstance: () => main('current'),
    openSettings: () => main('open_settings'),
    openExternal: (url) => main('open_external', { url }),
    authorizeOIDC: () => main('authorize_oidc'),
    status: () => main('status'),
    retry: () => main('retry')
  }
}

/** 设置页只调用实例管理动作；权限由原生命令再次检查。 */
export function tauriSettings(runtime) {
  const settings = (type, values = {}) => invoke(runtime.core, 'desktop_settings', { operation: { type, ...values } })
  return {
    state: () => settings('state'),
    addInstance: (name, url) => settings('add', { name, url }),
    updateInstance: (id, name, url) => settings('update', { id, name, url }),
    removeInstance: (id) => settings('remove', { id }),
    switchInstance: (id) => settings('switch', { id }),
    checkConnection: (url) => settings('check', { url }),
    onChanged: (callback) => runtime.event.listen('instances:changed', callback)
  }
}
