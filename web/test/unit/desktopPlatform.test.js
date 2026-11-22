import test from 'node:test'
import assert from 'node:assert/strict'
import { getDesktop, getDesktopSettings, platformFetch } from '../../src/platform/index.js'
import { startOIDCLogin } from '../../src/utils/oidcAutoStart.js'

test('浏览器保留原生 fetch，Electron 通过现有 preload 打开外链', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  globalThis.window = {}
  assert.equal(getDesktop(), null)
  assert.throws(getDesktopSettings, /需要桌面客户端/)
  const response = new Response('browser')
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    assert.equal(path, '/api/example')
    assert.equal(options.method, 'GET')
    return response
  })
  assert.equal(await platformFetch('/api/example', { method: 'GET' }), response)
  const opened = []
  window.yuxiDesktop = { openExternal: async (url) => opened.push(url) }
  await getDesktop().openExternal('https://example.com')
  assert.deepEqual(opened, ['https://example.com'])
})

test('Tauri 主页面和设置页面调用固定动作，OIDC 沿共用 callback 完成登录', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  const calls = []
  globalThis.window = {
    location: {},
    __TAURI__: {
      core: { invoke: async (command, arguments_) => {
        calls.push({ command, ...arguments_ })
        return { code: 'opaque-onetime-code' }
      } },
      event: { listen: async () => () => {} }
    }
  }
  await getDesktopSettings().updateInstance('instance-a', 'A', 'https://a.example')
  await startOIDCLogin(() => { throw new Error('应由原生端获取登录地址') })
  assert.deepEqual(calls, [
    { command: 'desktop_settings', operation: { type: 'update', id: 'instance-a', name: 'A', url: 'https://a.example' } },
    { command: 'desktop_main', operation: { type: 'authorize_oidc' } }
  ])
  assert.equal(window.location.href, '/auth/oidc/callback?code=opaque-onetime-code')
})

test('Tauri 字符串拒绝转为页面可显示的错误', async (t) => {
  const previous = globalThis.window
  t.after(() => { globalThis.window = previous })
  globalThis.window = { __TAURI__: { core: { invoke: async () => { throw '无法保存实例配置' } } } }
  await assert.rejects(getDesktopSettings().addInstance('A', 'https://a.example'), { message: '无法保存实例配置' })
  await assert.rejects(getDesktop().retry(), { message: '无法保存实例配置' })
  await assert.rejects(platformFetch('/api/agent/runs/test/events', { headers: { Accept: 'text/event-stream' } }),
    { message: '无法保存实例配置' })
})
