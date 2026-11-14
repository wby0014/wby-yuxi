'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { forwardHeaders } = require('../src/main/headers');

test('forwardHeaders 迭代 Headers 并剥离传输层头', () => {
  const headers = new Headers({
    authorization: 'Bearer yxkey_123',
    'content-type': 'application/json',
    host: 'app://yuxi',
    'content-length': '42',
    connection: 'keep-alive',
    accept: 'application/json',
  });
  const out = forwardHeaders(headers);
  assert.deepStrictEqual(out, {
    authorization: 'Bearer yxkey_123',
    'content-type': 'application/json',
    accept: 'application/json',
  });
});
