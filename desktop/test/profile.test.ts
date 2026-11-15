import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProfileStore } from '../src/profile.ts'

// 用可逆编码观测加密边界；操作系统密钥链由真实 Electron smoke 补充。
const secureStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'keychain',
  encryptString: (text: string) => Buffer.from(text.split('').reverse().join('')),
  decryptString: (buffer: Buffer) => buffer.toString().split('').reverse().join('')
}

function fixture(t: test.TestContext, storage = secureStorage) {
  const dir = mkdtempSync(join(tmpdir(), 'yuxi-profile-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, store: new ProfileStore(dir, storage) }
}

test('会话重启恢复，配置文件不保存明文 token', (t) => {
  const { dir, store } = fixture(t)
  store.setServer('https://one.example')
  store.setToken('test-session-token')
  assert.equal(readFileSync(join(dir, 'profile.json'), 'utf8').includes('test-session-token'), false)
  const restored = new ProfileStore(dir, secureStorage)
  assert.equal(restored.getState().token, 'test-session-token')
  assert.equal(restored.getState().serverUrl, 'https://one.example')
  store.setServer('https://two.example')
  assert.equal(store.getState().token, '')
  assert.equal(new ProfileStore(dir, secureStorage).getState().token, '')
})

test('不安全的 Linux 存储不落盘，登出清理加密凭据', (t) => {
  const unsafe = { ...secureStorage, getSelectedStorageBackend: () => 'basic_text' }
  const { dir, store } = fixture(t, unsafe)
  store.setServer('https://example.com')
  store.setToken('ephemeral-session')
  assert.equal(store.getState().token, 'ephemeral-session')
  assert.equal(store.getState().secureStorageAvailable, false)
  assert.equal(readFileSync(join(dir, 'profile.json'), 'utf8').includes('ephemeral'), false)
  assert.equal(new ProfileStore(dir, unsafe).getState().token, '')
  store.setToken('')
  assert.equal(store.getState().token, '')
})

test('持久化失败不能宣告登录成功，非法参数不改变状态', (t) => {
  const { dir, store } = fixture(t)
  assert.throws(() => store.setToken('x'), /服务/)
  store.setServer('https://example.com')
  rmSync(join(dir, 'profile.json'))
  mkdirSync(join(dir, 'profile.json'))
  assert.throws(() => store.setToken('new-session'))
  assert.equal(store.getState().token, '')
  assert.throws(() => store.setServer('http://example.com'))
  assert.equal(store.getState().serverUrl, 'https://example.com')
})
