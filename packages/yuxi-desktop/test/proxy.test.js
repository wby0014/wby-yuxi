'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyPath, buildForwardUrl } = require('../src/main/proxy');

test('classifyPath 分类 api/minio/static', () => {
  assert.deepStrictEqual(classifyPath('/api/agent/runs'), { kind: 'api' });
  assert.deepStrictEqual(classifyPath('/minio/public/x.png'), { kind: 'minio' });
  assert.deepStrictEqual(classifyPath('/assets/a.js'), { kind: 'static' });
  assert.deepStrictEqual(classifyPath('/login'), { kind: 'static' });
});

test('buildForwardUrl 拼接含 query', () => {
  assert.strictEqual(
    buildForwardUrl('https://yuxi.example.com', '/api/system/ready', ''),
    'https://yuxi.example.com/api/system/ready'
  );
  assert.strictEqual(
    buildForwardUrl('https://yuxi.example.com', '/agent/runs/1/events', '?verbose=false'),
    'https://yuxi.example.com/agent/runs/1/events?verbose=false'
  );
});
