'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { _electron: electron } = require('playwright-core');

const packageDir = path.resolve(__dirname, '../..');
const webVersion = require('../../../../web/package.json').version;
const { productName } = require('../../renderer/desktop-build.json');

/** 确定性 HTTP 对端只拥有桌面传输测试数据，不冒充真实 worker 证据。 */
async function serve(name) {
  const requests = [];
  let streamFinished = false;
  let available = true;
  let activeStreams = 0;
  const user = { id: 1, user_id: 1, uid: 'desktop-test', username: 'Desktop Test', role: 'user' };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    requests.push({ path: url.pathname, authorization: request.headers.authorization, cookie: request.headers.cookie, body });
    const json = (value) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(value)); };
    if (url.pathname === '/api/system/ready') return json({ status: available ? 'ready' : 'not_ready', version: webVersion });
    if (url.pathname === '/api/system/health') return json({ status: 'ok', version: webVersion });
    if (url.pathname === '/api/system/info') return json({ success: true, data: { branding: { name: '团队知识工作台' } } });
    if (url.pathname === '/api/auth/check-first-run') return json({ first_run: false });
    if (url.pathname === '/api/auth/oidc/config') return json({ enabled: true, provider_name: '测试身份登录' });
    if (url.pathname === '/api/auth/oidc/login-url') return json({ login_url: `http://127.0.0.1:${server.address().port}/identity` });
    if (url.pathname === '/identity') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      return response.end('<!doctype html><html><body><h1>测试身份服务</h1><a href="/callback">授权登录</a></body></html>');
    }
    if (url.pathname === '/callback') {
      response.writeHead(302, { location: '/auth/oidc/callback?code=desktop-onetime-code' });
      return response.end();
    }
    if (url.pathname === '/api/auth/oidc/exchange-code') {
      return json({ ...user, access_token: 'synthetic-oidc-token', token_type: 'bearer' });
    }
    if (url.pathname === '/api/auth/token') {
      return json({ ...user, access_token: 'synthetic-a-token', token_type: 'bearer' });
    }
    if (url.pathname === '/api/auth/me') return json(user);
    if (url.pathname === '/api/agent') return json({ agents: [] });
    if (url.pathname === '/api/desktop-test/echo') return json({ name, authorization: request.headers.authorization || null, cookie: request.headers.cookie || null });
    if (url.pathname === '/api/desktop-test/pending') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: waiting\n\n');
      activeStreams++;
      response.on('close', () => { activeStreams--; });
      return;
    }
    if (url.pathname === '/api/desktop-test/upload') return json({ bytes: body.length, containsFile: body.includes(Buffer.from('desktop-upload-content')) });
    if (url.pathname === '/api/desktop-test/download') {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="desktop-result.txt"' });
      return response.end('desktop-download-content');
    }
    if (url.pathname === '/api/desktop-test/stream-state') return json({ finished: streamFinished });
    if (url.pathname === '/api/desktop-test/stream') {
      streamFinished = false;
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      response.write('data: first\n\n');
      const timer = setTimeout(() => { streamFinished = true; response.end('data: final\n\n'); }, 1000);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (url.pathname.startsWith('/api/')) return json({});
    response.writeHead(404);
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, requests,
    setAvailable: (value) => { available = value; }, activeStreams: () => activeStreams,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

/** 等待本地 preload 可用，页面必须仍属于本地应用。 */
async function ready(page) {
  await page.waitForURL('app://yuxi/**');
  await page.waitForFunction(() => !!window.yuxiDesktop);
}

test('真实 Electron：实例隔离、PDF 模块、流式代理、文件、外链、OIDC 与恢复', { timeout: 180000 }, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-desktop-e2e-'));
  const a = await serve('A');
  const b = await serve('B');
  const stateFile = path.join(directory, 'instances.json');
  fs.writeFileSync(stateFile, JSON.stringify({ instances: [
    { id: 'a', name: '实例 A', url: a.url }, { id: 'b', name: '实例 B', url: b.url },
  ], currentId: 'a' }));
  const app = await electron.launch({
    executablePath: require('electron'), args: [packageDir],
    env: { ...process.env, YUXI_DESKTOP_USER_DATA: directory }, timeout: 30000,
  });
  t.after(async () => { await app.close(); await a.close(); await b.close(); });
  let page = await app.firstWindow();
  await ready(page);

  await t.test('打包 Web 登录页面通过本地协议提交凭据并保存会话', async () => {
    await page.goto('app://yuxi/login');
    await page.locator('.brand-main').filter({ hasText: '团队知识工作台' }).waitFor();
    assert.equal(await page.title(), '团队知识工作台');
    await page.getByPlaceholder('UID或手机号').fill('desktop-test');
    await page.locator('input[type=password]').fill('synthetic-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.waitForFunction(() => localStorage.getItem('user_token') === 'synthetic-a-token');
    const login = a.requests.find((request) => request.path === '/api/auth/token');
    assert.ok(login.body.includes(Buffer.from('desktop-test')));
    assert.ok(login.body.includes(Buffer.from('synthetic-password')));
  });

  await t.test('HTTP 代理使用实例会话中的 cookie，不读取默认会话', async () => {
    await app.evaluate(async ({ session }, url) => {
      await session.defaultSession.cookies.set({ url, name: 'session', value: 'synthetic-default' });
      await session.fromPartition('persist:yuxi-a').cookies.set({ url, name: 'session', value: 'synthetic-instance-a' });
    }, a.url);
    const echo = await page.evaluate(async () => (await fetch('/api/desktop-test/echo')).json());
    assert.equal(echo.cookie, 'session=synthetic-instance-a');
  });

  await t.test('PDF 模块在 Chromium 中实际导入，上传下载回读字节，SSE 首包早于终态', async () => {
    const worker = fs.readdirSync(path.join(packageDir, 'renderer/assets')).find((file) => file.startsWith('pdf.worker') && file.endsWith('.mjs'));
    const moduleLoaded = await page.evaluate(async (url) => typeof (await import(url)).WorkerMessageHandler, `/assets/${worker}`);
    assert.equal(moduleLoaded, 'function');
    const result = await page.evaluate(async () => {
      const data = new FormData();
      data.append('file', new File(['desktop-upload-content'], 'input.txt'));
      const upload = await (await fetch('/api/desktop-test/upload', { method: 'POST', body: data })).json();
      const download = await (await fetch('/api/desktop-test/download')).text();
      const stream = await fetch('/api/desktop-test/stream');
      const reader = stream.body.getReader();
      const first = await reader.read();
      const state = await (await fetch('/api/desktop-test/stream-state')).json();
      let output = new TextDecoder().decode(first.value);
      for (;;) { const next = await reader.read(); if (next.done) break; output += new TextDecoder().decode(next.value); }
      return { upload, download, state, output };
    });
    assert.equal(result.upload.containsFile, true);
    assert.equal(result.download, 'desktop-download-content');
    assert.equal(result.state.finished, false, '首包不得缓冲到整个 SSE 完成');
    assert.equal(result.output, 'data: first\n\ndata: final\n\n');
    const downloadedFile = path.join(directory, 'desktop-result.txt');
    await app.evaluate(({ session }, file) => {
      globalThis.downloadResult = new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ state: 'timeout' }), 10000);
        session.fromPartition('persist:yuxi-a').once('will-download', (_event, item) => {
          item.setSavePath(file);
          item.once('done', (_event, state) => { clearTimeout(timer); resolve({ state, filename: item.getFilename() }); });
        });
      });
    }, downloadedFile);
    await page.evaluate(async () => {
      const blob = await (await fetch('/api/desktop-test/download')).blob();
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'desktop-result.txt';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
    assert.deepEqual(await app.evaluate(() => globalThis.downloadResult), { state: 'completed', filename: 'desktop-result.txt' });
    assert.equal(fs.readFileSync(downloadedFile, 'utf8'), 'desktop-download-content');
  });

  await t.test('外链交系统浏览器入口，主窗口保持本地，危险协议拒绝', async () => {
    await app.evaluate(({ shell }) => { globalThis.openedLinks = []; shell.openExternal = async (url) => { globalThis.openedLinks.push(url); }; });
    await page.evaluate(() => window.open('https://example.com/docs', '_blank'));
    await page.evaluate(() => window.yuxiDesktop.openExternal('https://example.com/trace'));
    assert.deepEqual(await app.evaluate(() => globalThis.openedLinks), ['https://example.com/docs', 'https://example.com/trace']);
    assert.match(page.url(), /^app:\/\/yuxi\//);
    const denied = await page.evaluate(async () => {
      try { await window.yuxiDesktop.openExternal('file:///etc/passwd'); return false; } catch { return true; }
    });
    assert.equal(denied, true);
  });

  await t.test('隔离的 HTML 附件 srcdoc 仍可预览，子 frame 无法调用特权 IPC', async () => {
    await page.evaluate(() => {
      const iframe = document.createElement('iframe');
      iframe.id = 'desktop-preview-test';
      iframe.sandbox = 'allow-scripts';
      iframe.srcdoc = '<h1>附件预览内容</h1>';
      document.body.append(iframe);
    });
    await page.frameLocator('#desktop-preview-test').getByRole('heading', { name: '附件预览内容' }).waitFor();
    assert.equal(await page.frameLocator('#desktop-preview-test').locator('body').evaluate(() => !!window.yuxiDesktop), false);
    await page.locator('#desktop-preview-test').evaluate((element) => element.remove());
  });

  await t.test('独立授权窗截获回调，本地 Web 交换一次性码并登录', async () => {
    await page.evaluate(() => { localStorage.clear(); });
    await page.goto('app://yuxi/login');
    const authWindow = app.waitForEvent('window');
    await page.getByRole('button', { name: '测试身份登录' }).click();
    const auth = await authWindow;
    await auth.getByRole('link', { name: '授权登录' }).click();
    await page.waitForFunction(() => localStorage.getItem('user_token') === 'synthetic-oidc-token');
    assert.match(page.url(), /^app:\/\/yuxi\//);
    const exchange = a.requests.find((request) => request.path === '/api/auth/oidc/exchange-code');
    assert.equal(JSON.parse(exchange.body).code, 'desktop-onetime-code');
  });

  await page.evaluate(() => { sessionStorage.setItem('old-instance', 'A'); });
  const settingsEvent = app.waitForEvent('window');
  await page.evaluate(() => window.yuxiDesktop.openSettings());
  const settings = await settingsEvent;
  await settings.getByRole('heading', { name: '实例设置' }).waitFor();
  await t.test('设置支持主题和窄窗口，连接测试不改变当前实例', async () => {
    await settings.getByLabel('服务地址').fill(a.url);
    await settings.getByRole('button', { name: '测试连接' }).click();
    await settings.getByRole('status').filter({ hasText: '连接正常' }).waitFor();
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).currentId, 'a');
    const screenshots = process.env.YUXI_DESKTOP_ARTIFACT_DIR || path.join(directory, 'screenshots');
    fs.mkdirSync(screenshots, { recursive: true });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().includes('/__desktop/settings')).setSize(520, 650);
    });
    await settings.waitForFunction(() => window.innerWidth <= 520);
    assert.equal(await settings.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    for (const scheme of ['light', 'dark']) {
      await settings.emulateMedia({ colorScheme: scheme });
      await settings.waitForFunction((dark) => document.documentElement.classList.contains('dark') === dark, scheme === 'dark');
      await settings.screenshot({ path: path.join(screenshots, `settings-${scheme}.png`), fullPage: true });
    }
  });

  await t.test('删除当前 A 后新窗口只访问 B，旧 token 与 sessionStorage 均不存在', async () => {
    await page.evaluate(async () => {
      const response = await fetch('/api/desktop-test/pending');
      window.pendingReader = response.body.getReader();
      await window.pendingReader.read();
    });
    assert.equal(a.activeStreams(), 1);
    const nextWindow = app.waitForEvent('window');
    await settings.locator('li').filter({ hasText: '实例 A' }).getByRole('button', { name: '删除' }).click();
    await settings.getByRole('dialog').getByRole('button', { name: '删除实例' }).click();
    const old = page;
    page = await nextWindow;
    await ready(page);
    assert.equal(old.isClosed(), true);
    const result = await page.evaluate(async () => ({ token: localStorage.getItem('user_token'), oldState: sessionStorage.getItem('old-instance'),
      echo: await (await fetch('/api/desktop-test/echo')).json() }));
    assert.equal(result.token, null);
    assert.equal(result.oldState, null);
    assert.equal(result.echo.name, 'B');
    assert.equal(result.echo.authorization, null);
    assert.equal(result.echo.cookie, null);
    for (let attempt = 0; a.activeStreams() && attempt < 50; attempt++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(a.activeStreams(), 0, '实例切换必须取消旧窗口的在途响应');
    assert.equal(b.requests.some((request) => /synthetic-(?:a|oidc)-token/.test(request.authorization || '')), false);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).currentId, 'b');
  });

  await t.test('地址编辑退出旧会话，服务未就绪显示本地错误并可重连', async () => {
    await page.evaluate(() => localStorage.setItem('user_token', 'synthetic-b-token'));
    a.setAvailable(false);
    await settings.locator('li').filter({ hasText: '实例 B' }).getByRole('button', { name: '编辑' }).click();
    await settings.getByLabel('服务地址').fill(a.url);
    const replacement = app.waitForEvent('window');
    await settings.getByRole('button', { name: '保存修改' }).click();
    page = await replacement;
    await page.getByRole('heading', { name: '暂时无法连接' }).waitFor();
    await page.getByText('实例尚未就绪', { exact: false }).waitFor();
    const screenshots = process.env.YUXI_DESKTOP_ARTIFACT_DIR || path.join(directory, 'screenshots');
    await page.screenshot({ path: path.join(screenshots, 'status-unavailable.png'), fullPage: true });
    a.setAvailable(true);
    await page.getByRole('button', { name: '重新连接' }).click();
    await page.waitForURL('app://yuxi/');
    assert.equal(await page.evaluate(() => localStorage.getItem('user_token')), null);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).instances[0].url, a.url);
  });

  await t.test('主窗口关闭但设置仍开着时，activate 可以恢复主窗口', async () => {
    await page.close();
    const restored = app.waitForEvent('window');
    await app.evaluate(({ app }) => { app.emit('activate'); app.emit('activate'); app.emit('second-instance'); });
    page = await restored;
    await ready(page);
    assert.equal((await app.windows()).filter((window) => !window.isClosed() && !window.url().includes('__desktop/settings')).length, 1);
  });

  await t.test('删除最后实例显示本地引导页，不再请求占位端口', async () => {
    const onboarding = app.waitForEvent('window');
    await settings.locator('li').filter({ hasText: '实例 B' }).getByRole('button', { name: '删除' }).click();
    await settings.getByRole('dialog').getByRole('button', { name: '删除实例' }).click();
    page = await onboarding;
    await page.getByRole('heading', { name: `欢迎使用 ${productName}` }).waitFor();
    assert.equal(await page.getByRole('button', { name: '重新连接' }).isVisible(), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile)), { instances: [], currentId: null });
  });
  t.diagnostic(`界面截图：${process.env.YUXI_DESKTOP_ARTIFACT_DIR || path.join(directory, 'screenshots')}`);
});
