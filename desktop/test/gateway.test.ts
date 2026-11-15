import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { gzipSync } from 'node:zlib'
import { setTimeout as delay } from 'node:timers/promises'
import { createGateway } from '../src/gateway.ts'

async function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'yuxi-assets-'))
  mkdirSync(join(root, 'assets'))
  writeFileSync(join(root, 'index.html'), '<div id="app">test-app</div>')
  writeFileSync(join(root, 'assets', 'app.js'), 'export const value = 1')
  writeFileSync(join(root, 'assets', 'pdf.worker.mjs'), 'export const worker = true')
  const gateway = createGateway({ assetRoot: root, getServerUrl: () => '' })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return { root, gateway }
}

test('入口 history fallback 与缺失资产严格区分，拒绝非法 host/路径', async (t) => {
  const { gateway } = await fixture(t)
  const page = await gateway(new Request('app://yuxi/agent/project'))
  assert.equal(page.status, 200)
  assert.match(await page.text(), /test-app/)
  assert.match(page.headers.get('content-security-policy')!, /script-src app:\/\/yuxi\/assets\//)
  assert.equal((await gateway(new Request('app://yuxi/assets/missing.js'))).status, 404)
  const worker = await gateway(new Request('app://yuxi/assets/pdf.worker.mjs'))
  assert.match(worker.headers.get('content-type')!, /^text\/javascript/)
  assert.match(await worker.text(), /export const worker/)
  assert.equal((await gateway(new Request('app://other/index.html'))).status, 403)
  assert.equal((await gateway(new Request('app://yuxi/assets/%2e%2e%2f%2e%2e%2fsecret'))).status, 403)
  assert.equal((await gateway(new Request('app://yuxi/api/system/health'))).status, 503)
})

test('真实 HTTP 上游接收上传、认证与查询，剔除 cookie，不跟随外部 redirect', async (t) => {
  const { root } = await fixture(t)
  const requests: Array<{ url: string, method: string, auth: string, body: string, cookie: string }> = []
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url!, method: req.method!, auth: req.headers.authorization || '', body, cookie: req.headers.cookie || '' })
    if (req.url === '/api/redirect') {
      res.writeHead(307, { location: 'https://outside.example/steal' }).end()
    } else if (req.url === '/api/compressed') {
      const compressed = gzipSync(JSON.stringify({ compressed: true }))
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': compressed.length }).end(compressed)
    } else if (req.url === '/api/relative') {
      res.writeHead(307, { location: '/api/echo?next=1' }).end()
    } else {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'unsafe=1' }).end(JSON.stringify({ body }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address() as { port: number }
  const gateway = createGateway({ assetRoot: root, getServerUrl: () => `http://127.0.0.1:${address.port}` })
  const response = await gateway(new Request('app://yuxi/api/echo?q=1', { method: 'POST', headers: { Authorization: 'Bearer scoped-token', Cookie: 'unsafe=1' }, body: 'multipart-like-content' }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { body: 'multipart-like-content' })
  assert.equal(response.headers.has('set-cookie'), false)
  assert.deepEqual(requests[0], { url: '/api/echo?q=1', method: 'POST', auth: 'Bearer scoped-token', body: 'multipart-like-content', cookie: '' })
  assert.equal((await gateway(new Request('app://yuxi/api/redirect'))).status, 502)
  const redirect = await gateway(new Request('app://yuxi/api/relative'))
  assert.equal(redirect.status, 307)
  assert.equal(redirect.headers.get('location'), 'app://yuxi/api/echo?next=1')
  const decompressed = await gateway(new Request('app://yuxi/api/compressed'))
  assert.equal(decompressed.headers.has('content-encoding'), false)
  assert.equal(decompressed.headers.has('content-length'), false)
  assert.deepEqual(await decompressed.json(), { compressed: true })
})

test('SSE 首帧无需等待完成，取消下游会断开上游', async (t) => {
  const { root } = await fixture(t)
  let disconnected!: () => void
  const closed = new Promise<void>((resolve) => { disconnected = resolve })
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write('data: first-event\n\n')
    res.on('close', disconnected)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address() as { port: number }
  const gateway = createGateway({ assetRoot: root, getServerUrl: () => `http://127.0.0.1:${address.port}` })
  const response = await gateway(new Request('app://yuxi/api/events'))
  const reader = response.body!.getReader()
  const first = await reader.read()
  assert.match(new TextDecoder().decode(first.value), /first-event/)
  await reader.cancel()
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('upstream did not close')), 2000).unref())])
})


test('持续上传和慢首响应超过 30 秒仍可完成，服务切换能中止未返回响应的请求', { timeout: 45000 }, async (t) => {
  const { root } = await fixture(t)
  let uploadStarted!: () => void
  const started = new Promise<void>((resolve) => { uploadStarted = resolve })
  const server = createServer(async (req, res) => {
    if (req.url === '/api/slow') { await delay(31000); res.end('slow-ok'); return }
    if (req.url === '/api/pending') { req.on('close', () => res.destroy()); return }
    let body = ''
    try {
      for await (const chunk of req) { body += chunk; uploadStarted() }
      res.end(body)
    } catch { res.destroy() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => { server.closeAllConnections(); server.close() })
  const address = server.address() as { port: number }
  const gateway = createGateway({ assetRoot: root, getServerUrl: () => `http://127.0.0.1:${address.port}` })
  let bodyController!: ReadableStreamDefaultController<Uint8Array>
  const body = new ReadableStream<Uint8Array>({ start(controller) { bodyController = controller; controller.enqueue(new TextEncoder().encode('first-')) } })
  const upload = gateway(new Request('app://yuxi/api/upload', { method: 'POST', body, duplex: 'half' } as RequestInit))
  const slow = gateway(new Request('app://yuxi/api/slow'))
  await started
  // 上传一直有进度；不允许用覆盖整个请求的 30s deadline 截断。
  for (let second = 0; second < 31; second++) { await delay(1000); bodyController.enqueue(new TextEncoder().encode('.')) }
  bodyController.close()
  assert.equal((await upload).status, 200)
  assert.equal(await (await slow).text(), 'slow-ok')
  let pendingStarted!: () => void
  const pendingReady = new Promise<void>((resolve) => { pendingStarted = resolve })
  server.once('request', pendingStarted)
  const pending = gateway(new Request('app://yuxi/api/pending'))
  await pendingReady
  gateway.abortAll()
  assert.equal((await pending).status, 502)
})
