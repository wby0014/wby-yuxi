import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../../web/', import.meta.url))
const output = fileURLToPath(new URL('../web-dist/', import.meta.url))
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
  ['exec', 'vite', 'build', '--mode', 'desktop', '--outDir', output, '--emptyOutDir'],
  { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.error) console.error('Web 构建启动失败，请先安装 web 依赖')
process.exit(result.status ?? 1)
