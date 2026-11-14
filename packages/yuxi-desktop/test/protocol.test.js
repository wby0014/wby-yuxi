'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeRequest } = require('../src/main/protocol');

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
