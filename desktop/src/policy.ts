export const APP_ORIGIN = 'app://yuxi'

/** 仅接受根 origin；生产连接强制使用 TLS。 */
export function normalizeServerUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('请输入服务地址')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new Error('服务地址格式无效') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('服务地址必须使用 HTTPS；仅本机调试允许 HTTP')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('请填写不含账号、路径或参数的服务根地址')
  }
  return url.origin
}

/** 校验协议 host，并拒绝编码目录穿越和 Windows 路径分隔符。 */
export function safeAppPath(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'app:' || url.hostname !== 'yuxi' || url.port || url.username || url.password) return null
    const path = decodeURIComponent(url.pathname)
    if (path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) return null
    return path
  } catch { return null }
}

/** 只有固定前缀可进入远程服务网关。 */
export function isBackendPath(path: string): boolean {
  return path === '/api' || path.startsWith('/api/') || path === '/minio/public' || path.startsWith('/minio/public/')
}

/** Native bridge 不向 API、对象和静态资源文档授权。 */
export function isTrustedUiUrl(value: string): boolean {
  const path = safeAppPath(value)
  return path !== null && !isBackendPath(path) && !/^\/(assets|src|@vite|@id|@fs|node_modules)(\/|$)/.test(path) && !/\.[^/]+$/.test(path)
}

/** 同时核对窗口 identity、主 frame identity 与当前 UI 地址。 */
export function isTrustedSender(
  event: { sender: unknown, senderFrame: { url: string } | null },
  contents: { mainFrame: unknown }
): boolean {
  return event.sender === contents && event.senderFrame === contents.mainFrame && isTrustedUiUrl(event.senderFrame?.url || '')
}

/** 外链只交给系统浏览器处理普通 HTTP(S) URL。 */
export function isExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch { return false }
}
