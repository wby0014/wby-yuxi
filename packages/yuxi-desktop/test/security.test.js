'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isAppUrl, externalUrl, assertSender } = require('../src/main/security');
const { validateReleaseEnvironment } = require('../scripts/release');

test('应用 origin 与外链协议分别校验，拒绝伪造 host、凭据和本地执行协议', () => {
  assert.equal(isAppUrl('app://yuxi/agent'), true);
  for (const url of ['app://other/agent', 'https://yuxi/', 'app://user@yuxi/', 'app://yuxi:80/', 'invalid']) {
    assert.equal(isAppUrl(url), false, url);
  }
  assert.equal(externalUrl('https://example.com/docs'), 'https://example.com/docs');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'app://yuxi/', 'https://user:pass@example.com']) {
    assert.throws(() => externalUrl(url), /HTTP|Invalid/);
  }
});

test('同源 iframe、其他窗口和已导航到远端的 sender 均不能调用特权 IPC', () => {
  const frame = { url: 'app://yuxi/login' };
  const contents = { mainFrame: frame };
  const window = { isDestroyed: () => false, webContents: contents };
  assert.doesNotThrow(() => assertSender({ sender: contents, senderFrame: frame }, window, isAppUrl));
  assert.throws(() => assertSender({ sender: {}, senderFrame: frame }, window, isAppUrl), /非可信/);
  assert.throws(() => assertSender({ sender: contents, senderFrame: { url: frame.url } }, window, isAppUrl), /非可信/);
  frame.url = 'https://example.com/';
  assert.throws(() => assertSender({ sender: contents, senderFrame: frame }, window, isAppUrl), /非可信/);
});

test('正式发布拒绝缺少凭据、非 macOS 和非 Developer ID 证书', () => {
  assert.throws(() => validateReleaseEnvironment({}, 'darwin'), /缺少发布配置/);
  const env = { CSC_NAME: 'Developer ID Application: Example (EXAMPLE)', APPLE_ID: 'developer@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'synthetic', APPLE_TEAM_ID: 'EXAMPLE' };
  assert.doesNotThrow(() => validateReleaseEnvironment(env, 'darwin'));
  assert.throws(() => validateReleaseEnvironment(env, 'linux'), /macOS/);
  assert.throws(() => validateReleaseEnvironment({ ...env, CSC_NAME: 'Apple Development: Example' }, 'darwin'), /Developer ID/);
});
