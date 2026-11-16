'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { readProductName } = require('../scripts/brand-config');

test('桌面构建与打包配置从同一 YAML 提取名称，不携带其他字段', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-brand-config-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'brand.yaml');
  fs.writeFileSync(file, 'branding:\n  name: 团队知识工作台\norganization:\n  name: 独立组织\n');
  assert.equal(readProductName({ YUXI_BRAND_FILE_PATH: file }), '团队知识工作台');
  const value = execFileSync(process.execPath, ['-e', 'console.log(require("./electron-builder.js").productName)'], {
    cwd: path.resolve(__dirname, '..'), env: { ...process.env, YUXI_BRAND_FILE_PATH: file }, encoding: 'utf8',
  });
  assert.equal(value.trim(), '团队知识工作台');
  const template = path.resolve(__dirname, '../../../backend/package/yuxi/config/static/info.template.yaml');
  const readFileSync = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (file, ...options) => file === template
    ? 'branding:\n  name: 模板工作台\n'
    : readFileSync(file, ...options));
  assert.equal(readProductName({ YUXI_BRAND_FILE_PATH: path.join(directory, 'missing.yaml') }), '模板工作台');
});

test('品牌 YAML 中空名称、错误类型和损坏语法拒绝构建', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-brand-invalid-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'brand.yaml');
  for (const content of ['[]', 'branding: {}', 'branding: {name: "  "}', 'branding: {name: 123}']) {
    fs.writeFileSync(file, content);
    assert.throws(() => readProductName({ YUXI_BRAND_FILE_PATH: file }), /branding.name/);
  }
  fs.writeFileSync(file, 'branding: [');
  assert.throws(() => readProductName({ YUXI_BRAND_FILE_PATH: file }));
});
