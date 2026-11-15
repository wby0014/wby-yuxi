import test from 'node:test'
import assert from 'node:assert/strict'
import { startOIDCLogin } from '../../src/utils/oidcAutoStart.js'

test('桌面 OIDC 通过桥接一次性码返回本地 callback，浏览器保留原站点跳转', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  globalThis.window = { location: {} }
  await startOIDCLogin(async () => ({ login_url: 'https://identity.example/authorize' }))
  assert.equal(window.location.href, 'https://identity.example/authorize')
  window.yuxiDesktop = { authorizeOIDC: async () => ({ code: 'synthetic-code' }) }
  await startOIDCLogin(() => { throw new Error('桌面不应从渲染层发起授权'); })
  assert.equal(window.location.href, '/auth/oidc/callback?code=synthetic-code')
  window.yuxiDesktop.authorizeOIDC = async () => ({})
  await assert.rejects(startOIDCLogin(() => {}), /缺少授权码/)
})
