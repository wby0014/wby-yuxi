export interface DesktopState {
  serverUrl: string
  token: string
  secureStorageAvailable: boolean
}

export interface DesktopBridge {
  getState(): Promise<DesktopState>
  configureServer(url: string): Promise<boolean>
  setToken(token: string): Promise<void>
}

export const CHANNELS = {
  state: 'yuxi:state',
  server: 'yuxi:server',
  token: 'yuxi:token'
} as const
