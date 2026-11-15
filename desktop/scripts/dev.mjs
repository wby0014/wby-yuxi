import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import electron from 'electron'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const web = fileURLToPath(new URL('../../web/', import.meta.url))
const windows = process.platform === 'win32'
const built = spawnSync(windows ? 'npm.cmd' : 'npm', ['run', 'build:main'], { cwd: desktop, stdio: 'inherit', shell: windows })
if (built.status !== 0) process.exit(built.status ?? 1)
const requireWeb = createRequire(join(web, 'package.json'))
const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href)
let vite
let client
let stopping = false
async function stop(code = 0) {
  if (stopping) return
  stopping = true
  client?.kill()
  await vite?.close()
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop() })
try {
  process.chdir(web)
  vite = await createServer({ root: web, configFile: join(web, 'vite.config.js'), mode: 'desktop', server: { host: '127.0.0.1', port: 5173, strictPort: true } })
  // listen 成功才授权该 loopback 服务，避免端口占用时误载其他工程。
  await vite.listen()
  vite.printUrls()
  client = spawn(electron, [desktop], { cwd: desktop, stdio: 'inherit', env: { ...process.env, YUXI_DESKTOP_DEV_URL: 'http://127.0.0.1:5173' } })
  client.on('error', () => { void stop(1) })
  client.on('exit', (code) => { void stop(code ?? 0) })
} catch {
  console.error('桌面开发服务启动失败，请检查 5173 端口是否被占用及 Web 依赖是否已安装')
  await stop(1)
}
