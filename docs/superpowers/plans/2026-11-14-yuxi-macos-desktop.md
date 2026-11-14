# Yuxi macOS 桌面客户端 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Electron 壳本地打包 `web/dist`，做一个可配置多实例、签名公证后手动分发的 macOS 桌面客户端。

**Architecture:** 渲染进程加载原封不动的 Vue 构建产物；`app://` 自定义协议在主进程内复刻生产 nginx 行为（静态资源 + SPA 回退 + `/api`、`/minio/public/` 转发到当前实例）；实例配置存 `userData/instances.json`，通过菜单/托盘切换。

**Tech Stack:** Electron（≥28，需 `net.fetch`/`protocol.handle`/`Response` 全局）、Node `node:test`（无额外测试依赖）、electron-builder（打包/签名/公证）、CommonJS。

**设计依据：** `docs/superpowers/specs/2026-11-14-yuxi-macos-desktop-design.md`。

---

## 前置约定

- 所有代码在 `packages/yuxi-desktop/` 下，主进程用 CommonJS（`require`/`module.exports`）。
- 测试用 Node 内置 `node:test` + `assert`，文件命名 `test/*.test.js`，命令 `node --test test/<file>`。
- 每个 Task 的最后一步是 commit，提交信息用中文 Conventional Commit。
- 第一个硬验证关卡是 **SSE 流式是否被 protocol.handle 缓冲**（Task 6 冒烟、Task 10 端到端）；若缓冲则降级为「主进程起本地 HTTP 服务器转发」，其余设计不变。

---

## Task 1: 包骨架与构建脚本

**Files:**
- Create: `packages/yuxi-desktop/package.json`
- Create: `packages/yuxi-desktop/.gitignore`
- Create: `packages/yuxi-desktop/scripts/build-renderer.sh`

- [ ] **Step 1: 写 `package.json`（先不含依赖，脚本已定）**

```json
{
  "name": "yuxi-desktop",
  "version": "0.1.0",
  "description": "Yuxi macOS 桌面客户端",
  "private": true,
  "main": "src/main/index.js",
  "scripts": {
    "build:renderer": "bash scripts/build-renderer.sh",
    "start": "npm run build:renderer && electron .",
    "test": "node --test test/",
    "dist": "npm run build:renderer && electron-builder"
  }
}
```

- [ ] **Step 2: 写 `.gitignore`**

```gitignore
node_modules/
renderer/
dist/
build/
*.log
.DS_Store
```

- [ ] **Step 3: 写 `scripts/build-renderer.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WEB_DIST="$ROOT/web/dist"
OUT="$ROOT/packages/yuxi-desktop/renderer"

if [ ! -d "$WEB_DIST" ]; then
  echo "web/dist 不存在，先构建前端：cd $ROOT/web && npm install && npm run build" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT"
cp -R "$WEB_DIST/." "$OUT/"
echo "已复制 web/dist -> $OUT"
```

- [ ] **Step 4: 赋予执行权限并验证脚本能失败（web/dist 尚不存在）**

Run: `chmod +x packages/yuxi-desktop/scripts/build-renderer.sh && bash packages/yuxi-desktop/scripts/build-renderer.sh`
Expected: 退出码 1，输出「web/dist 不存在…」

- [ ] **Step 5: 安装依赖**

Run: `cd packages/yuxi-desktop && npm install --save-dev electron electron-builder`
Expected: `package.json` 的 `devDependencies` 出现 `electron` 与 `electron-builder`（版本由 npm 解析为当前稳定版）。

- [ ] **Step 6: Commit**

```bash
cd packages/yuxi-desktop
git add package.json .gitignore scripts/build-renderer.sh package-lock.json
git commit -m "chore(desktop): 初始化 Electron 包骨架与构建脚本"
```

---

## Task 2: 实例模型与 URL 规范化（纯逻辑 + TDD）

**Files:**
- Create: `packages/yuxi-desktop/src/main/instances.js`
- Test: `packages/yuxi-desktop/test/instances.test.js`

- [ ] **Step 1: 写失败测试 `test/instances.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalizeUrl, validateInstance, createInstancesRepo } = require('../src/main/instances');

test('normalizeUrl 补齐 https 并去尾斜杠', () => {
  assert.deepStrictEqual(normalizeUrl('example.com/'), { url: 'https://example.com' });
  assert.deepStrictEqual(normalizeUrl('http://a.b:8080///'), { url: 'http://a.b:8080' });
});

test('normalizeUrl 拒绝空、非法、非 http(s) 协议', () => {
  assert.ok(normalizeUrl('').error);
  assert.ok(normalizeUrl('not a url').error);
  assert.ok(normalizeUrl('ftp://x.com').error);
});

test('validateInstance 生成 id 并规范化', () => {
  const r = validateInstance({ name: ' prod ', url: 'yuxi.example.com' });
  assert.ok(!r.error);
  assert.strictEqual(r.instance.name, 'prod');
  assert.strictEqual(r.instance.url, 'https://yuxi.example.com');
  assert.ok(r.instance.id);
});

test('createInstancesRepo 增删切换', () => {
  const repo = createInstancesRepo();
  const a = repo.add({ id: 'a', name: 'A', url: 'https://a' });
  repo.add({ id: 'b', name: 'B', url: 'https://b' });
  assert.strictEqual(a.id, 'a');
  assert.strictEqual(repo.current().id, 'a'); // 首个自动设为当前
  assert.strictEqual(repo.setCurrent('b'), true);
  assert.strictEqual(repo.current().id, 'b');
  assert.strictEqual(repo.remove('b'), true);
  assert.strictEqual(repo.current().id, 'a'); // 删除当前后回退到剩余首个
});
```

- [ ] **Step 2: 运行验证失败**

Run: `cd packages/yuxi-desktop && node --test test/instances.test.js`
Expected: FAIL，报 `Cannot find module '../src/main/instances'`

- [ ] **Step 3: 实现 `src/main/instances.js`**

```js
'use strict';

const crypto = require('node:crypto');

/** 规范化实例 URL：补 https、去尾斜杠、只允许 http(s)。返回 { url } 或 { error }。 */
function normalizeUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return { error: '实例地址不能为空' };
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) && !/^https?:\/\//i.test(raw)) {
    return { error: '仅支持 http/https 协议' };
  }
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { error: '仅支持 http/https 协议' };
    }
    return { url: parsed.origin };
  } catch {
    return { error: '实例地址格式无效' };
  }
}

/** 校验并构造实例对象。返回 { instance } 或 { error }。 */
function validateInstance({ name, url }) {
  const trimmedName = String(name || '').trim();
  if (!trimmedName) return { error: '实例名称不能为空' };
  const normalized = normalizeUrl(url);
  if (normalized.error) return { error: normalized.error };
  return {
    instance: { id: crypto.randomUUID(), name: trimmedName, url: normalized.url },
  };
}

/** 内存态实例仓库：维护列表与当前实例 id，不负责持久化。 */
function createInstancesRepo(initial = { instances: [], currentId: null }) {
  let state = {
    instances: Array.isArray(initial.instances) ? initial.instances.slice() : [],
    currentId: initial.currentId || null,
  };

  return {
    list: () => state.instances.slice(),
    current: () => state.instances.find((i) => i.id === state.currentId) || null,
    add: (instance) => {
      state.instances.push(instance);
      if (!state.currentId) state.currentId = instance.id;
      return instance;
    },
    remove: (id) => {
      const exists = state.instances.some((i) => i.id === id);
      state.instances = state.instances.filter((i) => i.id !== id);
      if (state.currentId === id) {
        state.currentId = state.instances[0] ? state.instances[0].id : null;
      }
      return exists;
    },
    setCurrent: (id) => {
      if (!state.instances.some((i) => i.id === id)) return false;
      state.currentId = id;
      return true;
    },
    snapshot: () => ({ instances: state.instances.slice(), currentId: state.currentId }),
  };
}

module.exports = { normalizeUrl, validateInstance, createInstancesRepo };
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test test/instances.test.js`
Expected: PASS，4 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/instances.js test/instances.test.js
git commit -m "feat(desktop): 实例模型与 URL 规范化"
```

---

## Task 3: 实例持久化（JSON 文件 + TDD）

**Files:**
- Create: `packages/yuxi-desktop/src/main/instances-store.js`
- Test: `packages/yuxi-desktop/test/instances-store.test.js`

- [ ] **Step 1: 写失败测试 `test/instances-store.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { loadInstancesFile, saveInstancesFile } = require('../src/main/instances-store');

test('缺文件返回空', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  assert.deepStrictEqual(
    loadInstancesFile(path.join(dir, 'none.json')),
    { instances: [], currentId: null }
  );
});

test('save/load 往返一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  const file = path.join(dir, 'instances.json');
  const data = { instances: [{ id: 'a', name: 'A', url: 'https://a' }], currentId: 'a' };
  saveInstancesFile(file, data);
  assert.deepStrictEqual(loadInstancesFile(file), data);
});

test('损坏文件返回空并保留备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yuxi-'));
  const file = path.join(dir, 'bad.json');
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(loadInstancesFile(file), { instances: [], currentId: null });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('bad.json.corrupt-')));
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test test/instances-store.test.js`
Expected: FAIL，报 `Cannot find module '../src/main/instances-store'`

- [ ] **Step 3: 实现 `src/main/instances-store.js`**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** 读取实例 JSON；缺文件或损坏时返回空（损坏文件先备份）。 */
function loadInstancesFile(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      instances: Array.isArray(data.instances) ? data.instances : [],
      currentId: data.currentId || null,
    };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      try {
        fs.copyFileSync(filePath, `${filePath}.corrupt-${Date.now()}`);
      } catch {}
    }
    return { instances: [], currentId: null };
  }
}

/** 原子写回实例 JSON（先写临时文件再 rename）。 */
function saveInstancesFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

module.exports = { loadInstancesFile, saveInstancesFile };
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test test/instances-store.test.js`
Expected: PASS，3 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/instances-store.js test/instances-store.test.js
git commit -m "feat(desktop): 实例 JSON 持久化"
```

---

## Task 4: 路径分类与转发 URL（纯逻辑 + TDD）

**Files:**
- Create: `packages/yuxi-desktop/src/main/proxy.js`
- Test: `packages/yuxi-desktop/test/proxy.test.js`

- [ ] **Step 1: 写失败测试 `test/proxy.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { classifyPath, buildForwardUrl } = require('../src/main/proxy');

test('classifyPath 分类 api/minio/static', () => {
  assert.deepStrictEqual(classifyPath('/api/agent/runs'), { kind: 'api' });
  assert.deepStrictEqual(classifyPath('/minio/public/x.png'), { kind: 'minio' });
  assert.deepStrictEqual(classifyPath('/assets/a.js'), { kind: 'static' });
  assert.deepStrictEqual(classifyPath('/login'), { kind: 'static' });
});

test('buildForwardUrl 拼接含 query', () => {
  assert.strictEqual(
    buildForwardUrl('https://yuxi.example.com', '/api/system/ready', ''),
    'https://yuxi.example.com/api/system/ready'
  );
  assert.strictEqual(
    buildForwardUrl('https://yuxi.example.com', '/agent/runs/1/events', '?verbose=false'),
    'https://yuxi.example.com/agent/runs/1/events?verbose=false'
  );
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test test/proxy.test.js`
Expected: FAIL，报 `Cannot find module '../src/main/proxy'`

- [ ] **Step 3: 实现 `src/main/proxy.js`**

```js
'use strict';

/** 请求路径分类，与生产 nginx 的 location 规则一一对应。 */
function classifyPath(pathname) {
  if (pathname.startsWith('/api/')) return { kind: 'api' };
  if (pathname.startsWith('/minio/public/')) return { kind: 'minio' };
  return { kind: 'static' };
}

/** 构造转发到实例的完整 URL（baseUrl 已规范化、无尾斜杠）。 */
function buildForwardUrl(baseUrl, pathname, search) {
  return `${baseUrl}${pathname}${search || ''}`;
}

module.exports = { classifyPath, buildForwardUrl };
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test test/proxy.test.js`
Expected: PASS，2 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/proxy.js test/proxy.test.js
git commit -m "feat(desktop): 请求路径分类与转发 URL 构造"
```

---

## Task 5: 路由决策（静态 / SPA 回退 / 转发，纯逻辑 + TDD）

**Files:**
- Create: `packages/yuxi-desktop/src/main/protocol.js`
- Test: `packages/yuxi-desktop/test/protocol.test.js`

- [ ] **Step 1: 写失败测试 `test/protocol.test.js`**

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { routeRequest } = require('../src/main/protocol');

function tmpRenderer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'renderer-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'app.js'), 'console.log(1)');
  return dir;
}

test('api 与 minio 转发到实例', () => {
  const opts = { instanceUrl: 'https://yuxi.example.com', rendererDir: tmpRenderer() };
  assert.deepStrictEqual(
    routeRequest('/api/agent/runs', '', opts),
    { action: 'forward', url: 'https://yuxi.example.com/api/agent/runs' }
  );
  assert.deepStrictEqual(
    routeRequest('/minio/public/x.png', '?a=1', opts),
    { action: 'forward', url: 'https://yuxi.example.com/minio/public/x.png?a=1' }
  );
});

test('命中静态文件返回 file', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/assets/app.js', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'file');
  assert.ok(r.filePath.endsWith('assets/app.js'));
});

test('未命中回退 index.html（SPA 路由）', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/login', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'fallback');
  assert.ok(r.filePath.endsWith('index.html'));
});

test('目录穿越被拒绝，回退 index.html', () => {
  const dir = tmpRenderer();
  const r = routeRequest('/../secret.txt', '', { instanceUrl: 'https://x', rendererDir: dir });
  assert.strictEqual(r.action, 'fallback');
});
```

- [ ] **Step 2: 运行验证失败**

Run: `node --test test/protocol.test.js`
Expected: FAIL，报 `Cannot find module '../src/main/protocol'`

- [ ] **Step 3: 实现 `src/main/protocol.js`**

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * 决定一个 app:// 请求如何处理。
 * 返回 { action, ... }：
 *  - { action: 'forward', url }        转发到实例
 *  - { action: 'file', filePath }      返回 renderer 下静态文件
 *  - { action: 'fallback', filePath }  SPA 路由回退 index.html
 */
function routeRequest(pathname, search, { instanceUrl, rendererDir }) {
  if (pathname.startsWith('/api/') || pathname.startsWith('/minio/public/')) {
    return { action: 'forward', url: `${instanceUrl}${pathname}${search || ''}` };
  }

  // 静态资源：安全映射到 renderer 目录内，防目录穿越。
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidate = path.join(rendererDir, relative);
  const isInside =
    candidate === rendererDir || candidate.startsWith(rendererDir + path.sep);
  if (isInside && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return { action: 'file', filePath: candidate };
  }

  return { action: 'fallback', filePath: path.join(rendererDir, 'index.html') };
}

module.exports = { routeRequest };
```

- [ ] **Step 4: 运行验证通过**

Run: `node --test test/protocol.test.js`
Expected: PASS，4 个用例全绿。

- [ ] **Step 5: Commit**

```bash
git add src/main/protocol.js test/protocol.test.js
git commit -m "feat(desktop): app:// 路由决策（静态/SPA 回退/转发）"
```

---

## Task 6: Electron 主进程入口（协议注册 + 加载 dist + IPC）

**Files:**
- Create: `packages/yuxi-desktop/src/main/index.js`

- [ ] **Step 1: 确认前端产物存在（前置）**

Run: `cd web && npm install && npm run build`
Expected: 生成 `web/dist/index.html` 与 `web/dist/assets/`。
（若已构建过可跳过；`npm run build` 幂等。）

- [ ] **Step 2: 复制产物并确认**

Run: `cd packages/yuxi-desktop && npm run build:renderer && ls renderer/index.html renderer/assets`
Expected: 输出这两个路径，`renderer/` 下是 Vue 构建产物。

- [ ] **Step 3: 实现 `src/main/index.js`**

```js
'use strict';

const {
  app, BrowserWindow, protocol, net, ipcMain, Menu, dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { createInstancesRepo, validateInstance } = require('./instances');
const { loadInstancesFile, saveInstancesFile } = require('./instances-store');
const { routeRequest } = require('./protocol');
const { openSettingsWindow } = require('./settings-window');
const { buildMenu } = require('./menu');

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

let mainWindow = null;
let repo = null;
let instancesFile = null;
let rendererDir = null;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function mimeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function persist() {
  saveInstancesFile(instancesFile, repo.snapshot());
}

function currentInstanceUrl() {
  const cur = repo.current();
  return cur ? cur.url : 'http://127.0.0.1:1'; // 无实例时的占位，转发必然失败并返回 502
}

/** 去掉 net.fetch 会自行设置的传输层头，避免转发冲突。 */
function forwardHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k === 'host' || k === 'content-length' || k === 'connection') continue;
    out[k] = v;
  }
  return out;
}

function registerProtocol() {
  protocol.handle('app', async (request) => {
    const u = new URL(request.url);
    const decision = routeRequest(u.pathname, u.search, {
      instanceUrl: currentInstanceUrl(),
      rendererDir,
    });

    if (decision.action === 'forward') {
      const init = { method: request.method, headers: forwardHeaders(request.headers) };
      if (request.body) {
        init.body = request.body;
        init.duplex = 'half'; // 流式请求体（fetch 规范要求）
      }
      try {
        return await net.fetch(decision.url, init);
      } catch (err) {
        return new Response(
          JSON.stringify({ detail: `无法连接实例: ${err.message}` }),
          { status: 502, headers: { 'Content-Type': 'application/json; charset=utf-8' } }
        );
      }
    }

    try {
      const data = fs.readFileSync(decision.filePath);
      return new Response(data, {
        status: 200,
        headers: { 'Content-Type': mimeFor(decision.filePath), 'Cache-Control': 'no-cache' },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

async function switchInstance(id) {
  if (!repo.setCurrent(id)) return { error: '实例不存在' };
  persist();
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.session.clearStorageData({ storages: ['localstorage'] });
    mainWindow.webContents.reload();
  }
  rebuildMenu();
  return { instance: repo.current() };
}

function registerIpc() {
  ipcMain.handle('instances:list', () => repo.list());
  ipcMain.handle('instances:current', () => repo.current());
  ipcMain.handle('instances:add', (_e, { name, url }) => {
    const r = validateInstance({ name, url });
    if (r.error) return { error: r.error };
    repo.add(r.instance);
    persist();
    rebuildMenu();
    return { instance: r.instance };
  });
  ipcMain.handle('instances:remove', (_e, id) => {
    repo.remove(id);
    persist();
    rebuildMenu();
    return { ok: true };
  });
  ipcMain.handle('instances:switch', (_e, id) => switchInstance(id));
  ipcMain.handle('app:open-settings', () => { openSettingsWindow(); return { ok: true }; });
}

function rebuildMenu() {
  Menu.setApplicationMenu(
    buildMenu({
      repo,
      onOpenSettings: () => openSettingsWindow(),
      onSwitchInstance: (id) => switchInstance(id),
    })
  );
}

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, '../preload/main.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await mainWindow.loadURL('app://yuxi/index.html');
}

app.whenReady().then(() => {
  rendererDir = path.join(__dirname, '../../renderer');
  instancesFile = path.join(app.getPath('userData'), 'instances.json');
  repo = createInstancesRepo(loadInstancesFile(instancesFile));

  registerProtocol();
  registerIpc();
  rebuildMenu();
  createMainWindow();

  if (repo.list().length === 0) {
    dialog
      .showMessageBox(mainWindow, {
        type: 'info',
        title: '欢迎使用 Yuxi Desktop',
        message: '请先配置一个 Yuxi 实例',
        buttons: ['打开设置'],
      })
      .then(() => openSettingsWindow());
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

> 本 Task 只让主进程能启动、加载 `app://yuxi/index.html`；`settings-window.js`、`menu.js`、`../preload/main.js` 在 Task 7/8/9 补齐。当前先做「能启动 + 静态加载」，所以本 Task 末尾先不 `npm start` 到完整可跑，留到 Task 9 之后统一冒烟。

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js
git commit -m "feat(desktop): Electron 主进程入口（协议注册 + 加载 dist）"
```

---

## Task 7: 设置窗口（HTML + preload + IPC 接入）

**Files:**
- Create: `packages/yuxi-desktop/src/main/settings-window.js`
- Create: `packages/yuxi-desktop/src/preload/settings.js`
- Create: `packages/yuxi-desktop/src/settings/index.html`
- Create: `packages/yuxi-desktop/src/settings/settings.js`

- [ ] **Step 1: 实现 `src/main/settings-window.js`**

```js
'use strict';

const { BrowserWindow } = require('electron');
const path = require('node:path');

/** 打开实例设置窗口（本地文件加载，独立 preload）。 */
function openSettingsWindow() {
  const win = new BrowserWindow({
    width: 520,
    height: 460,
    title: 'Yuxi 实例设置',
    webPreferences: {
      preload: path.join(__dirname, '../preload/settings.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '../settings/index.html'));
  return win;
}

module.exports = { openSettingsWindow };
```

- [ ] **Step 2: 实现 `src/preload/settings.js`**

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  listInstances: () => ipcRenderer.invoke('instances:list'),
  currentInstance: () => ipcRenderer.invoke('instances:current'),
  addInstance: (name, url) => ipcRenderer.invoke('instances:add', { name, url }),
  removeInstance: (id) => ipcRenderer.invoke('instances:remove', id),
  switchInstance: (id) => ipcRenderer.invoke('instances:switch', id),
});
```

- [ ] **Step 3: 实现 `src/settings/index.html`**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Yuxi 实例设置</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
    h1 { font-size: 18px; }
    form { display: flex; gap: 8px; margin: 16px 0; }
    input { flex: 1; padding: 6px 8px; }
    ul { list-style: none; padding: 0; }
    li { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
    li span { flex: 1; }
    .err { color: #c00; }
  </style>
</head>
<body>
  <main>
    <h1>Yuxi 实例</h1>
    <form id="add-form">
      <input id="name" placeholder="名称（如：生产环境）" />
      <input id="url" placeholder="地址（如 yuxi.example.com）" />
      <button type="submit">添加</button>
    </form>
    <ul id="list"></ul>
    <p id="error" class="err"></p>
  </main>
  <script src="./settings.js"></script>
</body>
</html>
```

- [ ] **Step 4: 实现 `src/settings/settings.js`**

```js
'use strict';

const listEl = document.getElementById('list');
const errorEl = document.getElementById('error');
const form = document.getElementById('add-form');

async function render() {
  const [instances, current] = await Promise.all([
    window.settingsAPI.listInstances(),
    window.settingsAPI.currentInstance(),
  ]);
  listEl.innerHTML = '';
  for (const inst of instances) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${inst.name} (${inst.url})${inst.id === (current && current.id) ? ' [当前]' : ''}`;

    const useBtn = document.createElement('button');
    useBtn.textContent = '使用';
    useBtn.onclick = async () => {
      const r = await window.settingsAPI.switchInstance(inst.id);
      showError(r.error);
      if (!r.error) render();
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.onclick = async () => {
      await window.settingsAPI.removeInstance(inst.id);
      render();
    };

    li.append(label, useBtn, delBtn);
    listEl.append(li);
  }
}

function showError(msg) {
  errorEl.textContent = msg || '';
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('name').value;
  const url = document.getElementById('url').value;
  const r = await window.settingsAPI.addInstance(name, url);
  showError(r.error);
  if (!r.error) {
    form.reset();
    render();
  }
});

render();
```

- [ ] **Step 5: Commit**

```bash
git add src/main/settings-window.js src/preload/settings.js src/settings/index.html src/settings/settings.js
git commit -m "feat(desktop): 实例设置窗口与 IPC 接入"
```

---

## Task 8: 菜单与托盘（实例切换 / 打开设置 / 退出）

**Files:**
- Create: `packages/yuxi-desktop/src/main/menu.js`

- [ ] **Step 1: 实现 `src/main/menu.js`**

```js
'use strict';

const { Menu } = require('electron');

/**
 * 构建应用菜单。实例列表由 repo 提供；切换后 index.js 会 rebuildMenu()。
 */
function buildMenu({ repo, onOpenSettings, onSwitchInstance }) {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    {
      label: '实例',
      submenu: [
        ...repo.list().map((inst) => ({
          label: inst.name,
          type: 'radio',
          checked: repo.current() && repo.current().id === inst.id,
          click: () => onSwitchInstance(inst.id),
        })),
        { type: 'separator' },
        { label: '打开设置…', click: onOpenSettings },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  return Menu.buildFromTemplate(template);
}

module.exports = { buildMenu };
```

- [ ] **Step 2: 确认 `index.js` 已引用（Task 6 已含 `buildMenu`/`rebuildMenu`）**

核对 `src/main/index.js` 顶部有 `const { buildMenu } = require('./menu');`，且 `rebuildMenu()` 在 `whenReady`、`instances:add/remove`、`switchInstance` 三处被调用（Task 6 代码已覆盖）。无额外改动。

- [ ] **Step 3: Commit**

```bash
git add src/main/menu.js
git commit -m "feat(desktop): 原生菜单实例切换"
```

---

## Task 9: 主窗口 preload（`window.yuxiDesktop` 最小桥）

**Files:**
- Create: `packages/yuxi-desktop/src/preload/main.js`

- [ ] **Step 1: 实现 `src/preload/main.js`**

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuxiDesktop', {
  currentInstance: () => ipcRenderer.invoke('instances:current'),
  openSettings: () => ipcRenderer.invoke('app:open-settings'),
  onInstanceChanged: (cb) => {
    const listener = (_e, instance) => cb(instance);
    ipcRenderer.on('instances:changed', listener);
    return () => ipcRenderer.removeListener('instances:changed', listener);
  },
});
```

- [ ] **Step 2: 在 `index.js` 的 `switchInstance` 里补发变更事件**

把 `src/main/index.js` 的 `switchInstance` 中 `mainWindow.webContents.reload();` 之前插入一行：

```js
    mainWindow.webContents.send('instances:changed', repo.current());
```

（Vue 端当前不使用该桥，仅为后续「显示当前实例名/通知」预留；不影响现有功能。）

- [ ] **Step 3: Commit**

```bash
git add src/preload/main.js src/main/index.js
git commit -m "feat(desktop): 主窗口最小 preload 桥"
```

---

## Task 10: 端到端冒烟（手工验证，含 SSE 流式关卡）

**Files:** 无（验证为主，发现问题回修）。

- [ ] **Step 1: 本地起 Yuxi**

Run: `docker compose up --build -d`
Expected: `docker compose ps` 各服务健康，`curl --fail http://localhost:5050/api/system/ready` 返回 `ready`。

- [ ] **Step 2: 构建前端产物 + 桌面启动**

Run: `cd web && npm run build && cd ../packages/yuxi-desktop && npm start`
Expected: Electron 窗口弹出，首启弹「请先配置一个 Yuxi 实例」对话框与设置窗口。

- [ ] **Step 3: 添加实例并登录**

在设置窗口填：名称 `本地`、地址 `http://localhost:5173`（或生产 nginx 的 `http://localhost`，按你本地拓扑）；点「添加」后主窗口 reload，进入 Vue 登录页，用超级管理员账号登录。
Expected: 登录成功进入工作区，`window.localStorage` 出现 `user_token`。

- [ ] **Step 4: 验证 SSE 流式（硬关卡）**

与任意智能体对话，观察回答是否**逐字流式**出现（而非憋几秒一次性吐出）。
Expected: 流式。若一次性吐出 → `protocol.handle` 缓冲了 SSE，记录此问题，降级到「主进程起本地 HTTP 服务器转发」（方案 3），其余设计不变。

- [ ] **Step 5: 验证附件与文件预览**

上传一个附件到对话；在知识库/工作区打开一个文件预览（走 `/minio/public/`）。
Expected: 上传成功、预览正常渲染。

- [ ] **Step 6: 验证切换实例清 token**

添加第二个实例（可用同一地址），在菜单「实例」里切换。
Expected: 切换后主窗口 reload，回到登录页（localStorage 已被清空）。

- [ ] **Step 7: Commit（如有回修）**

若 Step 4 触发降级或有修复，提交对应改动；否则本 Task 无 commit。

---

## Task 11: 打包 + 签名 + 公证

**Files:**
- Create: `packages/yuxi-desktop/electron-builder.yml`

- [ ] **Step 1: 写 `electron-builder.yml`**

```yaml
appId: com.yuxi.desktop
productName: Yuxi Desktop
directories:
  output: dist
  buildResources: build
files:
  - src/**/*
  - renderer/**/*
  - package.json
  - "!**/*.map"
mac:
  target:
    - dmg
    - zip
  category: public.app-category.productivity
  # 签名：替换为你的 Developer ID Application 证书全名
  # identity: "Developer ID Application: Your Name (TEAMID)"
  # 公证：置 true 并导出 APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
  notarize: false
```

- [ ] **Step 2: 未签名本地打包冒烟**

Run: `cd packages/yuxi-desktop && npm run dist`
Expected: `dist/` 下生成 `Yuxi Desktop-0.1.0.dmg` 与 `-mac.zip`（未签名，仅本机验证安装包结构与启动）。

- [ ] **Step 3: 安装 dmg 冒烟**

打开 `dist/*.dmg`，把 App 拖进 Applications，启动。
Expected: 能启动、加载 Vue 界面（本机未签名版本会带「未识别开发者」提示，属预期）。

- [ ] **Step 4: 配置签名与公证（需 Apple Developer 凭据）**

编辑 `electron-builder.yml`：取消 `identity` 注释填入证书全名，`notarize: true`；导出环境变量：

```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

Run: `npm run dist`
Expected: 打包、签名、公证全部成功，`dist/` 产物在另一台/重新安装时无「未识别开发者」警告。

- [ ] **Step 5: Commit 打包配置**

```bash
git add electron-builder.yml
git commit -m "build(desktop): electron-builder 打包/签名/公证配置"
```

---

## Self-Review 结论

- **Spec 覆盖**：目标（本地打包 dist / 多实例 / 签名公证分发）→ Task 1/6/7/8/11；架构（app:// 协议 + 转发）→ Task 4/5/6；实例模型与存储 → Task 2/3；数据流（启动/静态/API/文件预览/切换）→ Task 6/8/10；认证（复用 Web JWT）→ Task 10 Step 3；错误处理（无实例/不可达/非法 URL/body 大小）→ Task 6（502、dialog、normalizeUrl 校验、body 透传）；安全（contextIsolation/sandbox/白名单/deny 新窗）→ Task 6/7/9；测试 → Task 2-5 单测 + Task 10 冒烟；构建签名公证 → Task 11。无缺口。
- **类型/命名一致性**：`routeRequest(pathname, search, opts)`、`createInstancesRepo`、`snapshot()`、`buildForwardUrl` 各任务签名一致；IPC 通道名 `instances:*`、`app:open-settings` 前后一致。
- **无占位符**：所有代码步骤均为完整可运行代码；唯一用户侧变量是 Apple 签名证书名与 env 凭据（真实密钥，非代码占位）。
