# Yuxi macOS 桌面客户端设计（Electron 壳 + 本地打包 dist）

- 日期：2026-11-14
- 状态：已确认（待进入实现计划）
- 范围：仅 macOS

## 背景

Yuxi 现只有 Web（Vue 3）与 CLI（`packages/yuxi-cli`）两种客户端形态，无原生桌面端。本文定义一个 macOS 桌面客户端：用 Electron 壳本地打包 Web 构建产物（`web/dist`），指向可配置的多个 Yuxi 部署实例，签名公证后手动分发。

关键技术事实（已核对源码）：

- Web 前端用相对路径 `fetch('/api/...')` 与 `fetch('/minio/public/...')`（`web/src/apis/base.js` 直接 `fetch(url)`），无绝对 API base。
- 前端路由是 `createWebHistory(import.meta.env.BASE_URL)`（history 模式），必须由服务器做 SPA 回退，不能 `loadFile(file://)`。
- 生产 nginx（`docker/nginx/default.conf`）：`/` → `try_files $uri /index.html`；`/api/` → `api:5050`；`/minio/public/` → `minio:9000`；SSE 段 `proxy_buffering off`；`/api/agent/runs` 请求体放宽到 100M。三者同源。
- 因此「实例」只需一个 origin URL，前端相对路径、生产拓扑、桌面代理三者完全对齐。

## 目标与非目标

### 目标（可验证）

- macOS 桌面 App 加载打包好的 Vue 界面，登录、对话（SSE 流式）、附件上传与文件预览全部可用。
- 能配置、切换多个 Yuxi 部署实例（同 CLI 的 remote 概念）。
- 产出签名 + 公证的 `.dmg`/`.zip`，手动分发，无 Gatekeeper「未识别开发者」警告。

### 非目标

- 不做 Windows / Linux。
- 不做自动更新（已确认手动分发）。
- 不改 backend / web 源码。
- 不做原生移动端。
- JWT 仍存渲染层 localStorage（keychain 存 token 后续再增强，本次不做）。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 界面来源 | 本地打包 `web/dist` |
| 桌面框架 | Electron |
| 实例模型 | 可配置多实例（同 CLI remote） |
| 目标平台 | 仅 macOS |
| 分发 | 签名 + 公证 + 手动分发（无 auto-update） |
| API 路由 | 方案 1：自定义 `app://` 协议 + 主进程内 `net.fetch` 转发 |

## 架构总览

三层，改动完全锁在桌面壳内部：

```
渲染进程 = 原封不动的 web/dist (Vue)
   │  fetch('/api/...')、fetch('/minio/public/...')、加载静态资源
   ▼
app:// 协议层 (protocol.handle)  ← 复刻 docker/nginx/default.conf 的行为
   │  ├ 静态资源 → renderer/ 文件
   │  ├ 未知路径 → 回退 index.html (SPA history)
   │  ├ /api/*  → net.fetch 转发到当前实例
   │  └ /minio/public/* → net.fetch 转发到当前实例
   ▼
主进程 (壳)：生命周期、单实例锁、BrowserWindow、菜单/托盘、实例存储、设置窗口
```

核心洞察：桌面 proxy 就是把生产 nginx 那段（静态 + `try_files` 回退 + `/api`/`/minio/public/` 同源转发 + SSE 不缓冲）搬进 Electron 主进程。

## 目录结构（新包 `packages/yuxi-desktop/`，与 `yuxi-cli` 平级）

```
packages/yuxi-desktop/
├── package.json              # electron、electron-builder 依赖与脚本
├── electron-builder.yml      # macOS 打包 + 签名 + 公证配置
├── .gitignore                # renderer/、dist/、build/
├── README.md
├── src/
│   ├── main/
│   │   ├── index.js          # app 生命周期、单实例锁、窗口、菜单、托盘
│   │   ├── protocol.js       # app:// 协议注册与分发
│   │   ├── proxy.js          # /api、/minio/public/ 转发（net.fetch，SSE 不缓冲）
│   │   ├── instances.js      # 实例 CRUD + 持久化
│   │   ├── settings-window.js# 设置小窗
│   │   └── menu.js           # 原生菜单 + 托盘（实例切换 / 打开设置 / 退出）
│   ├── preload/index.js      # contextBridge → window.yuxiDesktop
│   ├── settings/             # 设置窗口独立小页（实例增删切换）
│   └── assets/               # 应用图标、托盘图标
├── renderer/                 # 构建时从 ../../web/dist 拷贝（gitignore）
├── dist/                     # electron-builder 产物（gitignore）
└── scripts/build-renderer.sh # 构建 web → 拷贝 dist → renderer/
```

## 实例模型与存储

- 实例 = `{ id, name, url }`；`url` 是部署 origin（如 `https://yuxi.example.com`），`/api`、`/minio/public/` 都是其下路径。
- 用 `electron-store` 存 `userData` 下 JSON，不存凭据。
- `instances.js` 维护「实例列表 + 当前选中实例」，proxy 读当前实例 `url` 作转发目标。

## 关键数据流

- 启动：读实例列表 → 空则弹设置窗口；有则主窗口加载 `app://index.html`（当前实例）。
- 静态资源 + SPA 回退：`app://<path>` 命中 renderer 文件返回；否则回退 `index.html`（复刻 nginx `try_files $uri /index.html`）。
- API 转发：Vue `fetch('/api/...')` → 解析为 `app://api/...` → 命中 `/api/` → `net.fetch(instance.url + '/api/...')` 透传 method/headers/body → 返回，流式不缓冲（SSE）。
- 文件预览：`app://minio/public/...` → `net.fetch(instance.url + '/minio/public/...')`。
- 切换实例：菜单/托盘选实例 → 更新当前实例 → 清空 `app://` origin 的 storage（JWT 每实例独立）→ `mainWindow.reload()`。

## 认证

完全复用 Web 的账号密码 / OIDC 登录（`/api/auth/token` → JWT）。JWT 存渲染层 localStorage，proxy 只透传 `Authorization` 头，不参与认证语义；每实例 token 独立，切换实例清 storage。

## 错误处理

- 无实例：首启弹设置窗口，主窗口显示「请先配置实例」本地提示页。
- 实例不可达：`net.fetch` 网络错误 → 返回 502 + 简短 JSON；页面级失败给主进程错误页。
- 未登录/过期：前端 `base.js` 已有 401 → 登出跳 `/login`，proxy 透传即可。
- URL 非法：设置窗口校验 + 保存前 normalize（补 `https://`、去尾 `/`）。
- 请求体大小：proxy 透传 body 不设上限（`/api/agent/runs` 内联 base64 图可达 ~100M，nginx 已为此专门放宽）。

## 安全

- `contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`。
- preload 只暴露最小 API（当前实例名、打开设置、实例变更通知、平台信息）。
- 协议 handler 只认 `app://` 白名单；转发目标只来自用户配置的实例 url，不拼任意外部地址。
- `setWindowOpenHandler` 拒绝新窗口或交系统浏览器；不关闭 `webSecurity`。

## 测试

- 单元（node:test 或 vitest）：`proxy.js` 路径匹配与 URL 拼接、`instances.js` CRUD、`protocol.js` 静态回退与 SPA fallback。
- 冒烟（手工）：本地 `docker compose up` 起 Yuxi → 构建 dev 版 → 登录、对话（验证 SSE 流式）、附件上传与 `/minio/public/` 预览、切换实例。
- 打包冒烟：装 dmg → 打开 → 无「未识别开发者」→ 基本功能。
- 不改 backend/web，不触发其测试矩阵；按 `packages/` 约定补本包 README 与测试。

## 构建 / 签名 / 公证 / 分发

- 构建链：`web` 先 `npm run build` → `scripts/build-renderer.sh` 拷贝 `web/dist` → `renderer/` → electron-builder 打包 `.app`。
- 签名：electron-builder `identity: Developer ID Application`。
- 公证：electron-builder `notarize`（Apple notarytool + app-specific password）。
- 产物：`.dmg` + `.zip`，手动分发，无 auto-update。
- 前置依赖：Apple Developer 账号、Developer ID 证书、公证凭据、entitlements（Electron 默认 + 若需要 `com.apple.security.cs.allow-jit`）。

## 风险与验证关卡

唯一技术不确定性：`protocol.handle` + `net.fetch` 对 `text/event-stream` 的 SSE 流式是否被意外缓冲。实现「API 转发」时先做最小 SSE 冒烟；若缓冲则降级到方案 3（主进程起本地 HTTP 服务器转发），其余设计不变。「SSE 流式验证」列为第一个验证关卡。

## 后续

- 实现前按 Yuxi 仓库约定（`CLAUDE.md`）为非平凡变更补决策记录到 `docs/develop-guides/decisions/`（本 spec 是设计文档，决策记录是仓库要求的独立产物）。
- 本 spec 确认后进入 writing-plans，产出分步实现计划。
