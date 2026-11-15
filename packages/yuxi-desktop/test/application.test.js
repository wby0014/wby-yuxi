'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopApplication } = require('../src/main/application');
const { createInstancesRepo } = require('../src/main/instances');

/** 构建实例变更的窗口、会话与持久化观察点。 */
function fixture() {
  const desktop = new DesktopApplication({}, '/tmp/yuxi-desktop-test');
  desktop.repo = createInstancesRepo({
    instances: [
      { id: 'a', name: 'A', url: 'https://a.example' },
      { id: 'b', name: 'B', url: 'https://b.example' },
    ],
    currentId: 'a',
  });
  const events = [];
  desktop.closeMainWindow = async () => events.push(['close', desktop.repo.current()?.id]);
  desktop.clearInstanceSession = async (instance) => events.push(['clear', instance.id]);
  desktop.persistInstances = (state) => events.push(['save', state.currentId]);
  desktop.ensureMainWindow = async () => events.push(['open', desktop.repo.current()?.id]);
  desktop.refreshMenus = () => {};
  desktop.notifySettings = () => {};
  return { desktop, events };
}

test('删除当前实例先关闭旧窗口并清理会话，再发布新实例', async () => {
  const { desktop, events } = fixture();
  await desktop.changeInstances((repo) => repo.remove('a'));
  assert.equal(desktop.repo.current().id, 'b');
  assert.deepEqual(events, [['close', 'a'], ['clear', 'a'], ['clear', 'b'], ['save', 'b'], ['open', 'b']]);
});

test('删除最后实例进入本地配置页，仍清理旧凭据', async () => {
  const { desktop, events } = fixture();
  desktop.repo.remove('b');
  await desktop.changeInstances((repo) => repo.remove('a'));
  assert.equal(desktop.repo.current(), null);
  assert.deepEqual(events, [['close', 'a'], ['clear', 'a'], ['save', null], ['open', undefined]]);
});

test('编辑当前实例地址也执行隔离，而只改名称保持窗口', async () => {
  const { desktop, events } = fixture();
  await desktop.changeInstances((repo) => repo.update('a', { name: '改名', url: 'https://a.example' }));
  assert.deepEqual(events, [['save', 'a']]);
  assert.equal(desktop.boundInstance.name, '改名');
  events.length = 0;
  await desktop.changeInstances((repo) => repo.update('a', { name: '改名', url: 'https://new.example' }));
  assert.deepEqual(events, [['close', 'a'], ['clear', 'a'], ['save', 'a'], ['open', 'a']]);
});

test('并发切换串行提交，失败操作不阻塞后续操作', async () => {
  const { desktop, events } = fixture();
  await assert.rejects(desktop.changeInstances(() => { throw new Error('无效实例'); }), /无效实例/);
  await Promise.all([
    desktop.changeInstances((repo) => repo.setCurrent('b')),
    desktop.changeInstances((repo) => repo.setCurrent('a')),
  ]);
  assert.equal(desktop.repo.current().id, 'a');
  assert.deepEqual(events.filter(([event]) => event === 'open'), [['open', 'b'], ['open', 'a']]);
});

test('持久化失败不发布新代理目标并恢复旧实例窗口', async () => {
  const { desktop, events } = fixture();
  desktop.persistInstances = () => { throw new Error('磁盘写入失败'); };
  await assert.rejects(desktop.changeInstances((repo) => repo.setCurrent('b')), /磁盘写入失败/);
  assert.equal(desktop.repo.current().id, 'a');
  assert.deepEqual(events.at(-1), ['open', 'a']);
});

test('恢复主窗口排在实例清理之后，并发原生入口只保留一个窗口', async () => {
  const { desktop, events } = fixture();
  let release;
  desktop.clearInstanceSession = async () => new Promise((resolve) => { release = resolve; });
  let windows = 0;
  desktop.ensureMainWindow = async () => {
    if (!windows) { windows++; events.push(['create', desktop.repo.current().id]); }
  };
  const changing = desktop.changeInstances((repo) => repo.update('a', { name: '新地址', url: 'https://new.example' }));
  const restoring = Promise.all([desktop.openMainWindow(), desktop.openMainWindow()]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(windows, 0);
  release();
  await Promise.all([changing, restoring]);
  assert.equal(windows, 1);
  assert.equal(desktop.repo.current().url, 'https://new.example');
});

test('readiness 拒绝未就绪与界面版本不匹配的实例', async () => {
  let payload = { status: 'not_ready', version: '0.7.3' };
  const desktop = new DesktopApplication({ net: { fetch: async () => Response.json(payload) } }, '/tmp/yuxi-desktop-test');
  desktop.build = { webVersion: '0.7.3' };
  assert.equal((await desktop.checkConnection('https://a.example')).ok, false);
  payload = { status: 'ready', version: '0.7.2' };
  assert.match((await desktop.checkConnection('https://a.example')).message, /不一致/);
  payload.version = '0.7.3';
  assert.equal((await desktop.checkConnection('https://a.example')).ok, true);
});

test('运行中的单个代理请求失败返回 502 并保留当前页面', async (t) => {
  const { EventEmitter } = require('node:events');
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-request-error-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let handleRequest;
  const session = {
    protocol: {
      isProtocolHandled: async () => false,
      handle: (_scheme, handler) => { handleRequest = handler; },
    },
    fetch: async () => { throw new Error('网络连接中断'); },
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
  };
  class Window extends EventEmitter {
    constructor() {
      super();
      this.loadedUrls = [];
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    isDestroyed() { return false; }
    async loadURL(url) { this.loadedUrls.push(url); }
  }
  const desktop = new DesktopApplication({
    BrowserWindow: Window,
    session: { fromPartition: () => session },
    screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1440, height: 900 } }] },
  }, directory);
  desktop.repo = fixture().desktop.repo;
  desktop.checkConnection = async () => ({ ok: true });
  await desktop.ensureMainWindow();
  const response = await handleRequest(new Request('app://yuxi/api/example'));
  assert.equal(response.status, 502);
  assert.match((await response.json()).detail, /无法连接实例/);
  assert.deepEqual(desktop.mainWindow.loadedUrls, ['app://yuxi/']);
});
