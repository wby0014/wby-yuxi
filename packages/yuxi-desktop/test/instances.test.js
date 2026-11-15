'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeUrl, validateInstance, createInstancesRepo } = require('../src/main/instances');

test('normalizeUrl 补齐 https 并去尾斜杠', () => {
  assert.deepStrictEqual(normalizeUrl('example.com/'), { url: 'https://example.com' });
  assert.deepStrictEqual(normalizeUrl('http://a.b:8080///'), { url: 'http://a.b:8080' });
});

test('normalizeUrl 拒绝空、非法、非 http(s) 协议', () => {
  assert.ok(normalizeUrl('').error);
  assert.ok(normalizeUrl('not a url').error);
  assert.ok(normalizeUrl('ftp://x.com').error);
});

test('validateInstance 生成 id 并规范化', () => {
  const r = validateInstance({ name: ' prod ', url: 'yuxi.example.com' });
  assert.ok(!r.error);
  assert.strictEqual(r.instance.name, 'prod');
  assert.strictEqual(r.instance.url, 'https://yuxi.example.com');
  assert.ok(r.instance.id);
});

test('createInstancesRepo 增删切换', () => {
  const repo = createInstancesRepo();
  const a = repo.add({ id: 'a', name: 'A', url: 'https://a' });
  repo.add({ id: 'b', name: 'B', url: 'https://b' });
  assert.strictEqual(a.id, 'a');
  assert.strictEqual(repo.current().id, 'a'); // 首个自动设为当前
  assert.strictEqual(repo.setCurrent('b'), true);
  assert.strictEqual(repo.current().id, 'b');
  assert.strictEqual(repo.remove('b'), true);
  assert.strictEqual(repo.current().id, 'a'); // 删除当前后回退到剩余首个
});

test('重复地址、未知实例和包含路径或凭据的地址显式失败', () => {
  const repo = createInstancesRepo();
  repo.add({ id: 'a', name: 'A', url: 'https://a.example' });
  repo.add({ id: 'b', name: 'B', url: 'https://b.example' });
  assert.throws(() => repo.add({ id: 'c', name: 'C', url: 'https://a.example' }), /已经存在/);
  assert.throws(() => repo.update('b', { name: 'B', url: 'https://a.example' }), /已经存在/);
  assert.throws(() => repo.setCurrent('missing'), /不存在/);
  for (const url of ['https://a.example/path', 'https://u:p@a.example', 'https://a.example/?key=value']) {
    assert.ok(normalizeUrl(url).error);
  }
});
