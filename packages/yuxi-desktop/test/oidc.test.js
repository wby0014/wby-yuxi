'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { authorizeOIDC } = require('../src/main/oidc');

/** 提供可观察导航的授权窗，不加载业务或 preload。 */
async function fixture(t) {
  let window;
  class AuthWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
      this.webContents.session = { setPermissionRequestHandler: () => {} };
      window = this;
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
    async loadURL(url) { this.url = url; }
  }
  const controller = new AbortController();
  const result = authorizeOIDC({
    BrowserWindow: AuthWindow, instance: { url: 'https://instance.example' },
    fetch: async () => Response.json({ login_url: 'https://identity.example/authorize' }), signal: controller.signal,
  });
  t.after(() => controller.abort());
  await new Promise(setImmediate);
  return { window, result, controller };
}

test('授权窗口没有 preload，只接受当前实例顶层回调的一次性码', async (t) => {
  const { window, result } = await fixture(t);
  assert.equal(window.options.webPreferences.preload, undefined);
  assert.equal(window.options.webPreferences.sandbox, true);
  assert.match(window.url, /^https:\/\/identity.example/);
  const event = { url: 'https://other.example/auth/oidc/callback?code=wrong-instance-code', isMainFrame: true, preventDefault() { this.prevented = true; } };
  window.webContents.emit('will-redirect', event);
  assert.equal(event.prevented, undefined);
  window.webContents.emit('will-redirect', { ...event, url: 'https://instance.example/auth/oidc/callback?code=valid-onetime-code', isMainFrame: false });
  assert.equal(window.destroyed, false);
  const callback = { ...event, url: 'https://instance.example/auth/oidc/callback?code=valid-onetime-code' };
  window.webContents.emit('will-redirect', callback);
  assert.deepEqual(await result, { code: 'valid-onetime-code' });
  assert.equal(callback.prevented, true);
  assert.equal(window.destroyed, true);
});

test('关闭、实例切换与缺少授权码均显式失败', async (t) => {
  const closed = await fixture(t);
  closed.window.destroy();
  await assert.rejects(closed.result, /取消/);
  const switched = await fixture(t);
  switched.controller.abort();
  await assert.rejects(switched.result, /取消/);
  assert.equal(switched.window.destroyed, true);
  const invalid = await fixture(t);
  invalid.window.webContents.emit('will-redirect', { url: 'https://instance.example/auth/oidc/callback', isMainFrame: true, preventDefault() {} });
  await assert.rejects(invalid.result, /有效授权码/);
});
