import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlatform } from '../../src/platform/runtime.js'

function storage() {
  const values = new Map()
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
}

test('浏览器保留 localStorage 会话行为，无需 preload', async () => {
  const local = storage()
  local.setItem('user_token', 'browser-session')
  const platform = createPlatform({ storage: local })
  await platform.initializePlatform()
  assert.equal(platform.isDesktop, false)
  assert.equal(platform.getSessionToken(), 'browser-session')
  await platform.saveSessionToken('new-session')
  assert.equal(local.getItem('user_token'), 'new-session')
  await platform.saveSessionToken('')
  assert.equal(local.getItem('user_token'), null)
})

test('桌面先恢复会话，只经 bridge 持久化，不写 localStorage', async () => {
  const local = storage()
  local.setItem('user_token', 'stale-web-session')
  const written = []
  const platform = createPlatform({ storage: local, bridge: {
    getState: async () => ({ serverUrl: 'https://example.com', token: 'secure-session', secureStorageAvailable: true }),
    setToken: async (token) => written.push(token),
    configureServer: async () => false
  } })
  await platform.initializePlatform()
  assert.equal(platform.isDesktop, true)
  assert.equal(platform.getSessionToken(), 'secure-session')
  assert.equal(local.getItem('user_token'), null)
  await platform.saveSessionToken('new-secure-session')
  assert.deepEqual(written, ['new-secure-session'])
  assert.equal(local.getItem('user_token'), null)
  assert.equal(platform.getSessionToken(), 'new-secure-session')
})

test('桌面持久化失败不发布新 token，登出立即清除内存', async () => {
  const platform = createPlatform({ storage: storage(), bridge: {
    getState: async () => ({ serverUrl: 'https://example.com', token: 'old-session', secureStorageAvailable: false }),
    setToken: async () => { throw new Error('disk denied') }
  } })
  await platform.initializePlatform()
  await assert.rejects(platform.saveSessionToken('new-session'), /disk denied/)
  assert.equal(platform.getSessionToken(), 'old-session')
  await assert.rejects(platform.saveSessionToken(''), /disk denied/)
  assert.equal(platform.getSessionToken(), '')
})
