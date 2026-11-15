import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeServerUrl } from './policy.ts'
import type { DesktopState } from './contracts.ts'

interface SecureStorage {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

interface SavedProfile { serverUrl: string; encryptedToken?: string }

/** 只拥有应用配置与会话，绝不处理用户业务目录。 */
export class ProfileStore {
  private serverUrl = ''
  private token = ''
  private readonly file: string
  private readonly storage: SecureStorage

  constructor(directory: string, storage: SecureStorage) {
    this.file = join(directory, 'profile.json')
    this.storage = storage
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (!existsSync(this.file)) return
    const saved = JSON.parse(readFileSync(this.file, 'utf8')) as SavedProfile
    this.serverUrl = saved.serverUrl ? normalizeServerUrl(saved.serverUrl) : ''
    if (saved.encryptedToken && this.serverUrl && this.canPersist()) {
      // 密钥链变化时要求重新登录，不把不可解密的旧数据当作会话。
      try { this.token = storage.decryptString(Buffer.from(saved.encryptedToken, 'base64')) } catch { this.token = '' }
    }
  }

  /** 返回运行时状态，不把 token 暴露给日志或设置界面。 */
  getState(): DesktopState {
    return { serverUrl: this.serverUrl, token: this.token, secureStorageAvailable: this.canPersist() }
  }

  /** 发布服务变更前由 main 销毁旧窗口并取消请求。 */
  setServer(value: unknown): void {
    const serverUrl = normalizeServerUrl(value)
    if (serverUrl === this.serverUrl) return
    this.persist({ serverUrl })
    this.serverUrl = serverUrl
    this.token = ''
  }

  /** 非空会话落盘成功后才发布；登出先清内存，失败由调用方展示。 */
  setToken(value: unknown): void {
    if (typeof value !== 'string' || value.length > 32768) throw new Error('登录凭据格式无效')
    if (!this.serverUrl) throw new Error('请先配置服务地址')
    if (!value) this.token = ''
    const encryptedToken = value && this.canPersist() ? this.storage.encryptString(value).toString('base64') : undefined
    this.persist({ serverUrl: this.serverUrl, ...(encryptedToken ? { encryptedToken } : {}) })
    this.token = value
  }

  private canPersist(): boolean {
    return this.storage.isEncryptionAvailable() && this.storage.getSelectedStorageBackend?.() !== 'basic_text'
  }

  private persist(profile: SavedProfile): void {
    const temporary = this.file + '.tmp'
    writeFileSync(temporary, JSON.stringify(profile) + '\n', { mode: 0o600 })
    renameSync(temporary, this.file)
  }
}
