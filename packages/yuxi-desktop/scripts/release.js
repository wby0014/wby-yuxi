'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const path = require('node:path');
const { sanitizeFileName } = require('builder-util/out/filename');
const { readProductName } = require('./brand-config');

/** 发布前拒绝缺失的签名与公证条件，不输出凭据。 */
function validateReleaseEnvironment(env, platform) {
  if (platform !== 'darwin') throw new Error('正式签名和公证必须在 macOS 执行');
  const missing = ['CSC_NAME', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'].filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`缺少发布配置：${missing.join(', ')}`);
  if (!env.CSC_NAME.startsWith('Developer ID Application:')) throw new Error('CSC_NAME 必须指定 Developer ID Application 证书');
}

/** 签名摘要必须属于指定开发团队，拒绝临时签名与其他团队。 */
function validateSignature(summary, team) {
  if (!/^Authority=Developer ID Application:/m.test(summary) || !summary.split(/\r?\n/).includes(`TeamIdentifier=${team}`)) {
    throw new Error('产物没有预期团队的 Developer ID Application 签名');
  }
}

/** 构建后核对开发者签名与公证票据，产物只保存到本机。 */
function release() {
  validateReleaseEnvironment(process.env, process.platform);
  const cwd = path.resolve(__dirname, '..');
  const run = (command, args, options = {}) => execFileSync(command, args, { cwd, stdio: 'inherit', ...options });
  run(process.execPath, ['scripts/build-renderer.js']);
  const output = `dist/release-${process.arch}`;
  run(process.execPath, ['node_modules/electron-builder/out/cli/cli.js', '--config', 'electron-builder.release.cjs',
    `--${process.arch}`, `--config.directories.output=${output}`, '--publish', 'never']);
  const app = path.join(cwd, output, process.arch === 'x64' ? 'mac' : `mac-${process.arch}`, `${sanitizeFileName(readProductName())}.app`);
  run('codesign', ['--verify', '--deep', '--strict', app]);
  const signature = spawnSync('codesign', ['-dv', '--verbose=2', app], { cwd, encoding: 'utf8' });
  if (signature.error || signature.status !== 0) throw new Error('无法读取产物签名');
  validateSignature(signature.stderr, process.env.APPLE_TEAM_ID);
  run('xcrun', ['stapler', 'validate', app]);
  run('spctl', ['--assess', '--type', 'execute', app]);
}

if (require.main === module) {
  try { release(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { validateReleaseEnvironment, validateSignature };
