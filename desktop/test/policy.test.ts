import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeServerUrl, isTrustedUiUrl, isTrustedSender, isExternalUrl } from '../src/policy.ts'

test('服务 origin 规范化，生产地址必须使用 HTTPS', () => {
  assert.equal(normalizeServerUrl(' https://example.com:443/ '), 'https://example.com')
  assert.equal(normalizeServerUrl('http://127.0.0.1:5050/'), 'http://127.0.0.1:5050')
  assert.equal(normalizeServerUrl('http://[::1]:5050'), 'http://[::1]:5050')
  for (const value of ['http://example.com', 'file:///tmp', 'https://a:b@example.com', 'https://example.com/api', 'https://example.com/?token=x', 'https://example.com/#x', '', '//example.com']) {
    assert.throws(() => normalizeServerUrl(value), value)
  }
})

test('受信任 UI 排除远程 origin、API 与对象路径', () => {
  assert.equal(isTrustedUiUrl('app://yuxi/agent?thread=1'), true)
  assert.equal(isTrustedUiUrl('app://yuxi/login'), true)
  for (const value of ['https://yuxi/agent', 'app://other/agent', 'app://user@yuxi/', 'app://yuxi/api/auth/token', 'app://yuxi/minio/public/a.html', 'app://yuxi/assets/injected.html', 'about:srcdoc']) {
    assert.equal(isTrustedUiUrl(value), false, value)
  }
})

test('IPC 只接受当前主窗口的主 frame', () => {
  const mainFrame = { url: 'app://yuxi/login' }
  const contents = { mainFrame }
  assert.equal(isTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), true)
  assert.equal(isTrustedSender({ sender: {}, senderFrame: mainFrame }, contents), false)
  assert.equal(isTrustedSender({ sender: contents, senderFrame: { url: mainFrame.url } }, contents), false)
  mainFrame.url = 'app://yuxi/api/unsafe.html'
  assert.equal(isTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), false)
})

test('外链拒绝危险协议与嵌入凭据', () => {
  assert.equal(isExternalUrl('https://example.com/docs'), true)
  for (const value of ['javascript:alert(1)', 'file:///tmp/a', 'data:text/html,a', 'https://u:p@example.com', 'app://yuxi/']) {
    assert.equal(isExternalUrl(value), false)
  }
})
