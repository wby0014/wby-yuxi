# Yuxi Desktop Tauri

与 [Electron 客户端](../yuxi-desktop/README.md)并存的 macOS 桌面实现。Vue 业务来自 `web/src`，设置和状态页来自 `web/desktop`，平台接口位于 `web/src/platform`。Rust 核心负责实例配置、窗口、readiness、HTTP 传输和 OIDC 授权；业务权限、知识库和 Agent 执行仍由已部署的 Yuxi 服务拥有。

本模块处于原生验证阶段：共享前端和 Electron 回归已验证；Tauri 原生编译、真实 WebView 操作和安装尚未在开发环境执行通过。原生构建检查入口位于 [Desktop Quality](../../.github/workflows/desktop.yml)，配置存在不代表已通过。

## 开发运行

需要 macOS 14 或更高版本、Xcode Command Line Tools、Node.js 22、pnpm 和 Rust stable（至少 1.90）。从仓库根目录执行：

```bash
cd web
pnpm install --frozen-lockfile
cd ../packages/yuxi-desktop-tauri
npm install
npm start
```

`start` 先将共享前端构建至本模块独立的 `renderer/`，再启动 Tauri。修改 Web 源码后重启命令重新构建；此入口没有 Vite 热更新。品牌名称读取服务端静态品牌配置，展示名称追加 `Tauri`；图标从现有 `web/public/favicon.svg` 导出为 PNG/ICNS。

首次启动打开状态页与实例设置。实例地址只接受 HTTP(S) origin，例如 `https://yuxi.example.com`，不含路径、凭据、查询或片段。连接检测要求 `/api/system/ready` 就绪，且服务端版本等于打包 Web 版本。

## 会话与传输

应用 ID 为 `com.yuxi.desktop.tauri`，与 Electron 的应用身份、配置目录和构建目录独立，不自动迁移已有实例和登录数据。实例配置保存在系统应用数据目录的 `instances.json`，通过临时文件和原子替换保存；损坏配置先备份，无法读取或写入时显式报错。

每次创建主窗口都使用非持久 WebView 和独立 Rust Cookie jar。切换、删除当前实例、编辑当前地址会取消旧请求并销毁旧页面；仅修改名称保留页面。关闭主窗口后从 Dock 恢复或重启应用需要重新登录，实例列表仍保留。非持久会话避免依赖 WebView 异步清理完成的时序；跨窗口登录持久化不属于首版能力。

`yuxi://localhost` 提供已打包页面。业务 API 通过受限原生命令传输，保留请求方法、multipart boundary、二进制内容、HTTP 错误和 AbortSignal；响应按页面读取需求逐块拉取，SSE 不等待完整响应。页面只能访问该主窗口绑定实例的 `/api/` 与 `/minio/public/`，不能指定其他服务器。直接加载的图片和公开对象仍经本地协议转发；此路径缓冲完整响应。上传编码及 IPC 目前也会在内存中保留整个请求体，大文件性能需后续测量。

文件下载入口只接受本地主页面生成的 Blob，写入系统下载目录，文件名保留扩展名并追加随机后缀避免覆盖；失败弹出原生提示。HTML 附件沿用共享页面的 sandbox srcdoc 预览。PDF Worker、HTML 预览、文件落盘及跨实例隔离仍需要在真实 Tauri WebView 回读验证。

HTTP(S) 外链交给系统浏览器。OIDC 使用无应用命令权限的独立授权窗，只截获当前实例回调的一次性码，交由共享 Web 登录页交换；窗口关闭、实例切换或超时会取消授权。真实身份提供方尚未验证。

## 验证与打包

```bash
npm test
npm run build:renderer
npm run test:native
npm run check:native
npm run dist -- --bundles app --no-sign
```

JS 测试覆盖平台适配、错误展示、multipart 字节、增量读取、背压和取消。Rust 测试包含配置文件回读、固定目标边界、HTTP 首包、Cookie jar 隔离及下载来源校验；它们不替代 WebView 集成测试。首轮宿主验收需覆盖实例新增/编辑/删除、账号登录、A→B→A 隔离、SSE 首包与取消、上传后下载字节一致、PDF/HTML 预览、OIDC 和关闭窗口后恢复。

本地构建产物位于 `src-tauri/target/release/bundle/`。当前打包入口用于开发验证，未提供 Electron 的正式签名、公证和 Gatekeeper 校验流程；正式分发前必须完成这些流程及另一台 Mac 的安装验证。

当前开发环境缺少 Rust 工具链，npm 与 Rust 下载域名解析失败，因此尚未生成 `package-lock.json` 和 `Cargo.lock`。CI 首次联网解析后会上传锁文件供审阅。确认原生构建及依赖审计通过后，需要将锁文件纳入版本控制并切换到 `npm ci` / Cargo `--locked`，再进行可重复的分发构建。
