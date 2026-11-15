# Electron 桌面端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现不含本地 Agent 执行的远程服务型 Yuxi 桌面客户端。

**Architecture:** 同仓库增加 Electron main/preload，共享 Vue renderer。受限 app 协议网关统一承接 API、SSE 和公共对象，main 管理服务配置与加密会话。

**Tech Stack:** Electron、TypeScript、esbuild、electron-builder、现有 Vue/Vite、Node test runner。

**Spec:** [技术方案](../../develop-guides/decisions/implemented/2026-11-14-electron-desktop.md)

## Global Constraints

- 第一版不含 Agent 读写本地目录、命令执行、本地 MCP 或内嵌后端。
- 保留 Web JavaScript 与 pnpm 工程；desktop 独立 npm 工程。
- HTTPS 远程服务；HTTP 只允许 loopback；地址仅根 origin。
- 无安全存储时只保留进程内会话，不落明文 token。
- 保持 sandbox、contextIsolation、webSecurity，不暴露通用 IPC。
- 第一版账号密码登录、手动升级；签名、OIDC、自动更新与真实业务验收明确记录未验证范围。

## Review Focus

1. 旧窗口发出的带认证请求不能在切换服务后被发送到新服务：gateway 请求快照与 main 切换顺序共同覆盖。
2. 307/308、上传流与 SSE 取消不能悄悄丢失方法/请求体或挂死：真实 HTTP 集成测试覆盖。
3. 安全存储失败与重启不能恢复旧账户或写入明文 token：profile 测试覆盖。
4. 编码路径、远程脚本和 iframe 不能取得本地 UI/bridge 权限：policy、gateway 与 Electron smoke 覆盖。
5. Web 无 preload 时启动、登录和登出不变；桌面首次配置与失败状态可恢复：runtime 单测与真实页面验证覆盖。

## 文件职责

- `desktop/src/policy.ts`：地址、sender 与静态路径校验。
- `desktop/src/profile.ts`：当前服务与受保护会话的应用配置存储。
- `desktop/src/gateway.ts`：静态资源、history fallback、受限远程请求与取消。
- `desktop/src/contracts.ts`、`preload.ts`、`main.ts`：有限能力契约与 Electron 真实装配。
- `desktop/scripts/`：Web/主进程构建与本地开发入口。
- `desktop/test/`：Node 单测、HTTP 集成与 Electron 窗口 smoke。
- `web/src/platform/runtime.js`：浏览器/桌面会话与配置的最小平台适配。
- `web/src/components/desktop/DesktopConnection.vue`：首次服务配置、设置弹窗与状态反馈。
- Web main、App、user store、LoginView：装配适配，不改业务请求实现。
- `.github/workflows/desktop.yml`：只读测试、编译与打包检查，不自动发布。

### Task 1: 网关与配置边界

**Interfaces:** `normalizeServerUrl(value): string`、`isTrustedUiUrl(value): boolean`、`createGateway(options): (request: Request) => Promise<Response>`、`ProfileStore.getState()/setServer()/setToken()`。

- [x] 写 policy/profile/gateway 测试，先运行 `node --experimental-strip-types --test test/*.test.ts` 确认缺少实现而失败。
- [x] 实现最小边界与流式网关；真实本地 HTTP 服务验证方法、body、Authorization、SSE 首帧、取消和安全 redirect。
- [x] 用配置临时目录与加密适配证明落盘内容不含原 token、地址切换清凭据、不安全存储不落 token。
- [x] 运行同一测试集合与 TypeScript 检查，记录结果；不在独立 review 前提交。

```ts
assert.equal(normalizeServerUrl('https://example.com/'), 'https://example.com')
assert.throws(() => normalizeServerUrl('http://example.com'))
assert.throws(() => normalizeServerUrl('https://example.com/api'))
```

### Task 2: Electron 装配与构建

**Interfaces:** `window.yuxiDesktop` 仅包含 `getState()`、`configureServer(url)`、`setToken(token)`；IPC 由当前 main frame 校验后处理。

- [x] 写入 preload 契约、main 的安全配置与 smoke 断言；先验证 main/preload 尚不可构建。
- [x] 实现窗口、协议注册、权限拒绝、外链/下载确认及安全的服务切换。
- [x] 增加 esbuild、TypeScript、electron-builder 配置与锁文件；打包不携带配置、凭据或运行数据。
- [x] `npm run typecheck && npm run build:main`；在真实 Electron 中验证页面加载、bridge 可用、iframe 无 bridge。

```ts
assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
assert.equal(await page.evaluate(() => typeof window.yuxiDesktop.getState), 'function')
```

### Task 3: 共享 Vue 前端适配

**Interfaces:** `initializePlatform()`、`getSessionToken()`、`saveSessionToken(token)`、`isDesktop`、`getDesktopState()`、`configureServer(url)`。

- [x] 新增 runtime 测试并确认导入失败。
- [x] 实现浏览器 localStorage / 桌面内存与 IPC 会话，处理持久化错误，桌面启动恢复先于 router/store 使用。
- [x] App 在服务配置完成前只展示配置页，配置完成后保留原有业务视图；增加服务设置入口和会话存储说明。
- [x] user store 接入适配；桌面禁用 OIDC 自动跳转与入口，保留 Web 的 OIDC 流程。
- [x] 运行 Web 单测、只读 lint、production build；实际页面检查浅/深色、空态、错误态并保留截图证据。

```js
assert.equal(browserPlatform.getSessionToken(), 'browser-token')
await desktopPlatform.saveSessionToken('desktop-token')
assert.equal(storage.getItem('user_token'), null)
```

### Task 4: 打包与交付证据

- [x] 新增桌面 CI、开发说明、安装/签名边界与人工验收清单。
- [x] `cd desktop && npm test && npm run typecheck && npm run package:dir`，检查应用目录包含 main、preload 和 Web assets。
- [x] 运行 `python3 scripts/verify_engineering_contracts.py`、`python3 -m unittest scripts.test_verify_engineering_contracts`、`git diff --check`。
- [x] 全新 reviewer 对照需求、完整 diff 和实际结果审查；修复重要问题后重跑相关测试。
- [x] 决策记录更新为实际事实；真实后端、安装、签名与升级未运行时保留 Not run，交付分支但不自动提交或发布。
