import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { APP_ORIGIN, isBackendPath, safeAppPath } from './policy.ts'

interface GatewayOptions {
  assetRoot: string
  getServerUrl(): string
  developmentUrl?: string
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream',
  '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
}
const HOP_HEADERS = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

/** 自定义协议的文档策略只信任打包代码，不信任远程 API 返回的脚本。 */
function contentPolicy(development: boolean): string {
  const scripts = development
    ? `${APP_ORIGIN}/src/ ${APP_ORIGIN}/@vite/ ${APP_ORIGIN}/@id/ ${APP_ORIGIN}/@fs/ ${APP_ORIGIN}/node_modules/ ${APP_ORIGIN}/assets/`
    : `${APP_ORIGIN}/assets/`
  return `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'${development ? ' ws://127.0.0.1:5173' : ''}; worker-src ${APP_ORIGIN}/assets/ blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'`
}

/** 清除逐跳头和 cookie，避免远程服务修改本地应用的 origin 状态。 */
function cleanHeaders(input: Headers, response = false): Headers {
  const headers = new Headers(input)
  const nominated = (headers.get('connection') || '').split(',').map((item) => item.trim()).filter(Boolean)
  for (const name of [...HOP_HEADERS, ...nominated, 'host', 'cookie', 'set-cookie', 'origin', 'referer', 'content-length']) headers.delete(name)
  // Node fetch 会解压 body；不能把原压缩头留给 Chromium 再解压。
  if (response) {
    headers.delete('content-encoding')
    headers.delete('access-control-allow-origin')
    headers.delete('access-control-allow-credentials')
  }
  return headers
}

/** 按请求快照转发流，取消下游时立即释放上游连接。 */
export function createGateway(options: GatewayOptions) {
  const active = new Set<AbortController>()
  const root = resolve(options.assetRoot)
  const policy = contentPolicy(Boolean(options.developmentUrl))

  async function forward(request: Request, target: URL, backend: boolean): Promise<Response> {
    const controller = new AbortController()
    active.add(controller)
    const abort = () => controller.abort()
    request.signal.addEventListener('abort', abort, { once: true })
    if (request.signal.aborted) abort()
    const cleanup = () => {
      active.delete(controller)
      request.signal.removeEventListener('abort', abort)
    }
    // 上传与等待首响应不设整段总期限；传输超时交给 HTTP 层，用户取消和服务切换仍立即中止。
    try {
      const init: RequestInit & { duplex?: string } = {
        method: request.method, headers: cleanHeaders(request.headers),
        signal: controller.signal, redirect: 'manual'
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        init.body = request.body
        init.duplex = 'half'
      }
      const upstream = await fetch(target, init)
      const headers = cleanHeaders(upstream.headers, true)
      headers.set('x-content-type-options', 'nosniff')
      headers.set('cache-control', 'no-store')
      headers.set('content-security-policy', backend ? "default-src 'none'; sandbox; frame-ancestors 'none'" : policy)
      if (upstream.status >= 300 && upstream.status < 400 && headers.has('location')) {
        const destination = new URL(headers.get('location')!, target)
        if (destination.origin !== target.origin || !backend || !isBackendPath(destination.pathname) || destination.username || destination.password) {
          await upstream.body?.cancel()
          cleanup()
          return new Response('服务重定向已被安全策略拒绝', { status: 502 })
        }
        headers.set('location', APP_ORIGIN + destination.pathname + destination.search)
      }
      if (!upstream.body || request.method === 'HEAD') {
        await upstream.body?.cancel()
        cleanup()
        return new Response(null, { status: upstream.status, headers })
      }
      const reader = upstream.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(destination) {
          try {
            const { done, value } = await reader.read()
            if (done) { cleanup(); destination.close() } else destination.enqueue(value)
          } catch (error) { cleanup(); destination.error(error) }
        },
        async cancel() {
          controller.abort()
          try { await reader.cancel() } catch (error) { if (!controller.signal.aborted) throw error } finally { cleanup() }
        }
      })
      return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers })
    } catch {
      cleanup()
      return new Response('无法连接服务，请检查网络和服务地址', { status: 502 })
    }
  }

  /** API 与静态资源共用固定 app origin，拒绝其他 host 和越界路径。 */
  async function handle(request: Request): Promise<Response> {
    const path = safeAppPath(request.url)
    if (path === null) return new Response('访问被拒绝', { status: 403 })
    const incoming = new URL(request.url)
    if (isBackendPath(path)) {
      const server = options.getServerUrl()
      if (!server) return new Response('请先配置服务地址', { status: 503 })
      const target = new URL(server)
      target.pathname = incoming.pathname
      target.search = incoming.search
      return forward(request, target, true)
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('方法不允许', { status: 405 })
    if (options.developmentUrl) {
      const target = new URL(options.developmentUrl)
      target.pathname = incoming.pathname
      target.search = incoming.search
      return forward(request, target, false)
    }
    let file = resolve(root, '.' + path)
    if (file !== root && !file.startsWith(root + sep)) return new Response('访问被拒绝', { status: 403 })
    if (path === '/' || (!extname(path) && !path.startsWith('/assets/'))) file = resolve(root, 'index.html')
    try {
      const actual = await realpath(file)
      const actualRoot = await realpath(root)
      if (!actual.startsWith(actualRoot + sep) || !(await stat(actual)).isFile()) return new Response('访问被拒绝', { status: 403 })
      const bytes = request.method === 'HEAD' ? null : new Uint8Array(await readFile(actual))
      return new Response(bytes, { headers: {
        'content-type': MIME[extname(actual)] || 'application/octet-stream',
        'content-security-policy': policy, 'x-content-type-options': 'nosniff', 'cache-control': 'no-store'
      } })
    } catch { return new Response('资源不存在', { status: 404 }) }
  }

  return Object.assign(handle, {
    abortAll() { for (const controller of active) controller.abort(); active.clear() }
  })
}
