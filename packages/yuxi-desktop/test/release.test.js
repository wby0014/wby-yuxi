'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateReleaseEnvironment, validateSignature } = require('../scripts/release');

const environment = { CSC_NAME: 'Developer ID Application: Example', APPLE_ID: 'release@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'synthetic-password', APPLE_TEAM_ID: 'EXAMPLETEAM' };

test('正式发布在开始构建前拒绝缺失配置、错误证书与非 macOS', () => {
  assert.throws(() => validateReleaseEnvironment({}, 'darwin'), /缺少发布配置/);
  assert.throws(() => validateReleaseEnvironment({ ...environment, CSC_NAME: '-' }, 'darwin'), /Developer ID Application/);
  assert.throws(() => validateReleaseEnvironment(environment, 'linux'), /macOS/);
  assert.doesNotThrow(() => validateReleaseEnvironment(environment, 'darwin'));
});

test('发布产物拒绝临时签名与错误团队，接受指定 Developer ID 团队', () => {
  assert.throws(() => validateSignature('Signature=adhoc\nTeamIdentifier=not set\n', 'EXAMPLETEAM'), /预期团队/);
  assert.throws(() => validateSignature('Authority=Developer ID Application: Example\nTeamIdentifier=OTHER\n', 'EXAMPLETEAM'), /预期团队/);
  assert.doesNotThrow(() => validateSignature('Authority=Developer ID Application: Example\nTeamIdentifier=EXAMPLETEAM\n', 'EXAMPLETEAM'));
});
