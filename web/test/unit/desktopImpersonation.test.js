import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createPlatform } from '../../src/platform/runtime.js'

const source = readFileSync(new URL('../../src/components/DebugComponent.vue', import.meta.url), 'utf8')
const switchSource = source.slice(source.indexOf('const switchToUser ='), source.indexOf('// ==================== LOCALSTORAGE'))
const handler = switchSource.match(/onOk: (async \(\) => \{[\s\S]*\n {4}\})\n {2}\}\)/)[1]

for (const desktop of [false, true]) {
  test(`切换用户并刷新恢复目标会话：${desktop ? '桌面安全存储' : '浏览器原存储'}`, async () => {
    const values = new Map()
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) }
    let saved = 'old-account'
    const bridge = desktop ? { getState: async () => ({ serverUrl: 'https://example.com', token: saved, secureStorageAvailable: true }), setToken: async (token) => { saved = token } } : undefined
    const platform = createPlatform({ bridge, storage })
    await platform.initializePlatform()
    const events = []
    const onOk = new Function('state', 'authApi', 'saveSessionToken', 'localStorage', 'message', 'showModal', 'window', 'user', `return (${handler})`)(
      {}, { impersonateUser: async () => ({ access_token: 'target-account' }) }, platform.saveSessionToken,
      storage, { success: () => {}, error: (error) => events.push(error) }, { value: true },
      { location: { reload: () => events.push('reload') } }, { id: 2, username: 'target' }
    )
    await onOk()
    const restarted = createPlatform({ bridge, storage })
    await restarted.initializePlatform()
    assert.deepEqual(events, ['reload'])
    assert.equal(restarted.getSessionToken(), 'target-account')
    if (desktop) assert.equal(storage.getItem('user_token'), null)
  })
}

test('切换用户持久化失败时不刷新、不显示成功', async () => {
  const events = []
  const onOk = new Function('state', 'authApi', 'saveSessionToken', 'localStorage', 'message', 'showModal', 'window', 'user', `return (${handler})`)(
    {}, { impersonateUser: async () => ({ access_token: 'target-account' }) }, async () => { throw new Error('disk denied') },
    { setItem: () => {} }, { success: () => events.push('success'), error: (error) => events.push(error) }, { value: true },
    { location: { reload: () => events.push('reload') } }, { id: 2, username: 'target' }
  )
  await onOk()
  assert.deepEqual(events, ['切换失败: disk denied'])
})
