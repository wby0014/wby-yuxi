import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'

// 单独 Electron 入口复用 shipping main，不向产品添加测试专用 IPC 或环境后门。
if (!process.versions.electron) {
  const { default: executable } = await import('electron')
  const directory = mkdtempSync(join(tmpdir(), 'yuxi-electron-smoke-'))
  const cleanup = () => rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  const child = spawn(executable, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, YUXI_SMOKE_USER_DATA: directory } })
  child.on('error', (error) => { cleanup(); console.error(error.message); process.exitCode = 1 })
  child.on('exit', (code) => { cleanup(); process.exitCode = code ?? 1 })
} else {
  const { app, BrowserWindow, dialog, safeStorage } = await import('electron')
  const directory = process.env.YUXI_SMOKE_USER_DATA || mkdtempSync(join(tmpdir(), 'yuxi-electron-smoke-'))
  const screenshots = process.env.YUXI_QA_DIR || join(tmpdir(), 'yuxi-desktop-qa')
  mkdirSync(screenshots, { recursive: true })
  app.setPath('userData', directory)
  // 真实操作系统密钥链需人工验证；自动化显式验证无安全存储时的降级分支。
  safeStorage.isEncryptionAvailable = () => false
  const seen = []
  let streamClosed = 0
  const servers = []
  const errors = []
  const deadline = setTimeout(() => { console.error('Electron smoke timeout'); app.exit(1) }, 60000)
  app.on('web-contents-created', (_event, contents) => {
    contents.on('did-finish-load', () => console.log('Smoke loaded:', contents.getURL()))
    contents.on('did-fail-load', (_event, code, description, url) => console.error('Smoke load failed:', code, description, url))
    contents.on('render-process-gone', (_event, detail) => console.error('Smoke renderer exited:', detail.reason))
    contents.on('console-message', (event) => {
      if (event.level === 'error' && !event.message.includes('Content Security Policy') && !event.message.includes('Refused to load')) errors.push(event.message)
    })
  })
  async function waitFor(check, label) {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await check()) return
      await delay(50)
    }
    throw new Error('Timed out: ' + label)
  }
  async function createBackend(label) {
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      seen.push({ label, path: req.url, method: req.method, auth: req.headers.authorization, body })
      if (req.url === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write('data: smoke-event\n\n')
        res.on('close', () => { streamClosed++ })
        return
      }
      if (req.url === '/api/payload.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.__remoteScriptExecuted = true')
        return
      }
      if (req.url === '/api/redirect-upload') { res.writeHead(307, { location: '/api/upload' }).end(); return }
      if (req.url === '/api/fail') { res.writeHead(503).end('unavailable'); return }
      const data = req.url === '/api/auth/check-first-run' ? { first_run: false }
        : req.url === '/api/system/health' ? { status: 'ok' }
          : req.url === '/api/system/info' ? { branding: { name: 'Yuxi' }, organization: {}, footer: {} }
            : { received: body, service: label }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(data))
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    servers.push(server)
    return `http://127.0.0.1:${server.address().port}`
  }
  const firstServer = await createBackend('first')
  const secondServer = await createBackend('second')
  await import('../dist/main.cjs')
  // 主模块必须先结束求值，Electron 才发送 ready；不能在顶层 await whenReady。
  void runWindowChecks()
  async function runWindowChecks() {
    try {
      await app.whenReady()
      console.log('Smoke app ready')
      await waitFor(() => BrowserWindow.getAllWindows()[0]?.webContents.getURL().startsWith('app://yuxi'), 'initial window')
      let window = BrowserWindow.getAllWindows()[0]
      const evaluate = (code) => window.webContents.executeJavaScript(code)
      /** 等字体、绘制与弹窗动画完成后保存真实可见页面。 */
      const capture = async (name) => {
        await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
        await delay(350)
        writeFileSync(join(screenshots, name + '.png'), (await window.webContents.capturePage()).toPNG())
      }
      await waitFor(() => evaluate(`Boolean(document.querySelector('input[name="serverUrl"]'))`), 'configuration form')
      assert.equal(await evaluate('typeof window.require'), 'undefined')
      assert.deepEqual(await evaluate('Object.keys(window.yuxiDesktop).sort()'), ['configureServer', 'getState', 'setToken'])
      assert.equal((await evaluate('window.yuxiDesktop.getState()')).serverUrl, '')
      await delay(100)
      await capture('first-run-light')
      await evaluate(`localStorage.setItem('theme', 'dark')`)
      window.webContents.reload()
      await once(window.webContents, 'did-finish-load')
      await waitFor(() => evaluate(`Boolean(document.querySelector('input[name="serverUrl"]'))`), 'dark form')
      assert.equal(await evaluate("document.documentElement.classList.contains('dark')"), true)
      await capture('first-run-dark')
      window.setSize(960, 640)
      await capture('first-run-compact')
      window.setSize(1440, 960)
      await evaluate(`localStorage.setItem('theme', 'light')`)
      window.webContents.reload()
      await once(window.webContents, 'did-finish-load')
      await waitFor(() => evaluate(`Boolean(document.querySelector('input[name="serverUrl"]'))`), 'light form')
      await evaluate(`{ const input = document.querySelector('input[name="serverUrl"]'); input.value = 'http://example.com'; input.dispatchEvent(new Event('input', { bubbles: true })); }`)
      await waitFor(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`), 'enabled submit')
      await evaluate(`void setTimeout(() => document.querySelector('button[type="submit"]').click(), 10)`)
      await waitFor(() => evaluate(`document.querySelector('.connection-alert')?.textContent.includes('无法保存地址')`), 'validation error')
      await capture('invalid-server')
      await evaluate(`{ const input = document.querySelector('input[name="serverUrl"]'); input.value = ${JSON.stringify(firstServer)}; input.dispatchEvent(new Event('input', { bubbles: true })); }`)
      await waitFor(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`), 'enabled submit')
      await evaluate(`void setTimeout(() => document.querySelector('button[type="submit"]').click(), 10)`)
      const old = window
      await waitFor(() => BrowserWindow.getAllWindows().some((candidate) => candidate !== old), 'configured replacement window')
      window = BrowserWindow.getAllWindows().find((candidate) => candidate !== old)
      await waitFor(() => evaluate(`Boolean(document.querySelector('.login-card'))`), 'password login page')
      assert.equal((await evaluate('window.yuxiDesktop.getState()')).serverUrl, firstServer)
      assert.equal(await evaluate(`localStorage.getItem('user_token')`), null)
      assert.equal(await evaluate(`document.body.textContent.includes('桌面端使用账号密码登录')`), true)
      await capture('login')
      await evaluate(`document.querySelector('.desktop-service-button').click()`)
      await waitFor(() => evaluate(`Boolean(document.querySelector('.ant-modal'))`), 'settings dialog')
      await capture('server-settings')
      await evaluate(`document.querySelector('.ant-modal-close').click()`)
      const upload = await evaluate(`(async () => { const form = new FormData(); form.append('file', new File(['upload-proof'], 'test.txt')); return await (await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer smoke-scope' }, body: form })).json() })()`)
      assert.match(upload.received, /upload-proof/)
      assert.ok(seen.some((request) => request.path === '/api/upload' && request.auth === 'Bearer smoke-scope' && request.body.includes('filename="test.txt"')))
      assert.equal(await evaluate(`(async () => (await fetch('/api/fail')).status)()`), 503)
      const replayed = await evaluate(`(async () => (await fetch('/api/redirect-upload', { method: 'POST', body: 'redirected-upload' })).json())()`)
      assert.equal(replayed.received, 'redirected-upload')
      const firstEvent = await evaluate(`(async () => { const reader = (await fetch('/api/events')).body.getReader(); const first = await reader.read(); await reader.cancel(); return new TextDecoder().decode(first.value) })()`)
      assert.match(firstEvent, /smoke-event/)
      await waitFor(() => streamClosed > 0, 'SSE cancellation')
      await evaluate(`new Promise((resolve) => { const script = document.createElement('script'); script.src = '/api/payload.js'; script.onload = resolve; script.onerror = resolve; document.head.appendChild(script) })`)
      assert.equal(await evaluate('window.__remoteScriptExecuted'), undefined)
      await evaluate(`const frame = document.createElement('iframe'); frame.sandbox = 'allow-scripts'; frame.srcdoc = '<p>Untrusted preview</p>'; document.body.appendChild(frame)`)
      await waitFor(() => window.webContents.mainFrame.frames.length > 0, 'sandbox iframe')
      assert.equal(await window.webContents.mainFrame.frames[0].executeJavaScript('typeof window.yuxiDesktop'), 'undefined')
      await evaluate(`localStorage.setItem('old-service-draft', 'draft'); window.yuxiDesktop.setToken('session-only-smoke')`)
      assert.equal(readFileSync(join(directory, 'profile.json'), 'utf8').includes('session-only-smoke'), false)
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
      const beforeSwitch = window
      await evaluate(`void setTimeout(() => { void window.yuxiDesktop.configureServer(${JSON.stringify(secondServer)}).catch(() => {}) }, 10)`)
      await waitFor(() => BrowserWindow.getAllWindows().some((candidate) => candidate !== beforeSwitch), 'service switch window')
      window = BrowserWindow.getAllWindows().find((candidate) => candidate !== beforeSwitch)
      await waitFor(() => evaluate(`Boolean(document.querySelector('.login-card'))`), 'new service login')
      const state = await evaluate('window.yuxiDesktop.getState()')
      assert.equal(state.serverUrl, secondServer)
      assert.equal(state.token, '')
      assert.equal(await evaluate(`localStorage.getItem('old-service-draft')`), null)
      assert.equal(seen.filter((request) => request.label === 'second' && request.auth).length, 0)
      assert.deepEqual(errors.filter((error) => !error.includes('status of 503') && !error.includes('服务地址必须使用 HTTPS')), [])
      console.log('PASS Electron shipping-window smoke: setup, validation, login, settings, upload, SSE cancel, script/iframe isolation, service switch')
      console.log('QA screenshots: ' + screenshots)
    } catch (error) {
      console.error(error)
      console.error('Renderer errors:', errors)
      const failedWindow = BrowserWindow.getAllWindows()[0]
      if (failedWindow && !failedWindow.isDestroyed()) {
        console.error('Failed page:', await failedWindow.webContents.executeJavaScript('document.body.innerText'))
        writeFileSync(join(screenshots, 'failure.png'), (await failedWindow.webContents.capturePage()).toPNG())
      }
      process.exitCode = 1
    } finally {
      clearTimeout(deadline)
      for (const server of servers) { server.closeAllConnections(); server.close() }
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
      // 先退出 Electron；父进程再删除独有 userData，避免 Chromium 尚在写缓存。
      app.exit(process.exitCode || 0)
    }
  }
}
