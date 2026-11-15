'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { loadInstancesFile, saveInstancesFile } = require('../src/main/instances-store');

test('缺文件返回空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  assert.deepStrictEqual(
    loadInstancesFile(path.join(dir, 'none.json')),
    { instances: [], currentId: null }
  );
});

test('save/load 往返一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  const file = path.join(dir, 'instances.json');
  const data = { instances: [{ id: 'a', name: 'A', url: 'https://a' }], currentId: 'a' };
  saveInstancesFile(file, data);
  assert.deepStrictEqual(loadInstancesFile(file), data);
});

test('损坏文件返回空并保留备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(loadInstancesFile(file), { instances: [], currentId: null });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bad.json.corrupt-')));
});

test('结构损坏与非法持久化地址备份后拒绝加载', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  const file = path.join(dir, 'invalid.json');
  fs.writeFileSync(file, JSON.stringify({ instances: [{ id: '../escape', name: 'A', url: 'file:///tmp' }] }));
  assert.deepStrictEqual(loadInstancesFile(file), { instances: [], currentId: null });
  assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('invalid.json.corrupt-')));
});
