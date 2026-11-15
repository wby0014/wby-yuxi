'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeRequest, createProtocolHandler } = require('../src/main/protocol');

function tmpRenderer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

test('api 与 minio 转发到实例', () => {
  const opts = { instanceUrl: 'https://yuxi.example.com', rendererDir: tmpRenderer() };
  assert.deepStrictEqual(
    routeRequest('/api/agent/runs', '', opts),
    { action: 'forward', url: 'https://yuxi.example.com/api/agent/runs' }
  );
  assert.deepStrictEqual(
    routeRequest('/minio/public/x.png', '?a=1', opts),
    { action: 'forward', url: 'https://yuxi.example.com/minio/public/x.png?a=1' }
  );
});

test('命中静态文件返回 file', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/assets/app.js', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'file');
  assert.ok(r.filePath.endsWith('assets/app.js'));
});

test('未命中回退 index.html（SPA 路由）', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/login', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'fallback');
  assert.ok(r.filePath.endsWith('index.html'));
});

test('目录穿越被拒绝，回退 index.html', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/../secret.txt', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'fallback');
});

test('PDF 模块 Worker 返回 JavaScript MIME，错误 app host 拒绝访问', async () => {
  const dir = tmpRenderer();
  fs.writeFileSync(path.join(dir, 'assets', 'worker.mjs'), 'export const ready = true;');
  const handle = createProtocolHandler({ rendererDir: dir, instance: null });
  const response = await handle(new Request('app://yuxi/assets/worker.mjs'));
  assert.match(response.headers.get('content-type'), /javascript/);
  assert.match(await response.text(), /ready/);
  assert.equal((await handle(new Request('app://untrusted/assets/worker.mjs'))).status, 403);
});

test('代理绑定窗口实例并传递认证、查询、body 和取消信号', async () => {
  const observed = [];
  const handle = createProtocolHandler({
    rendererDir: tmpRenderer(),
    instance: { url: 'https://a.example' },
    fetch: async (url, init) => {
      observed.push({ url, authorization: init.headers.authorization, body: await new Response(init.body).text(), signal: init.signal });
      return new Response('done');
    },
  });
  const abort = new AbortController();
  const request = new Request('app://yuxi/api/upload?name=hello', { method: 'POST', headers: { authorization: 'Bearer synthetic-a' }, body: 'upload-bytes', signal: abort.signal });
  assert.equal(await (await handle(request)).text(), 'done');
  assert.equal(observed[0].url, 'https://a.example/api/upload?name=hello');
  assert.equal(observed[0].authorization, 'Bearer synthetic-a');
  assert.equal(observed[0].body, 'upload-bytes');
  abort.abort();
  assert.equal(observed[0].signal.aborted, true);
});
