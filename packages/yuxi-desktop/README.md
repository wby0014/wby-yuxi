# Yuxi Desktop

产品展示名称由[品牌配置](../../docs/advanced/branding.md)的 `branding.name` 统一提供。构建会同步原生菜单、窗口、本地引导页和应用包名称；应用 ID、包名和已有数据目录保持稳定。修改名称后重新构建客户端，退出旧进程并打开新包。

Yuxi 的 macOS 桌面客户端。Electron 加载本地打包的 Vue 页面，通过 `app://yuxi` 提供静态资源，并将 `/api/*`、`/minio/public/*` 转发到选中的 Yuxi 服务。业务状态、权限、知识库和智能体执行由服务端拥有；客户端运行需要已部署的 Yuxi 实例。

[Tauri 客户端](../yuxi-desktop-tauri/README.md)位于独立模块。两者共用 `web/src` 业务、`web/desktop` 设置与状态页，以及 `scripts/desktop` 构建辅助；Electron 保留自己的主进程、preload、应用 ID、数据和发布流程。

## 开发运行

需要 macOS、Node.js 22 和 pnpm。以下命令从仓库根目录开始：

```bash
cd web
pnpm install --frozen-lockfile
cd ../packages/yuxi-desktop
npm ci
npm start
```

`start`、`dist` 和 `dist:release` 都先从当前 Web 源码直接构建到本模块被 Git 忽略的 `renderer/`，并复制共享设置页、主题和版本元数据。两种宿主不共享可写构建产物。首次启动显示本地引导和实例设置。实例地址只接受 HTTP(S) origin，例如 `http://localhost:5050` 或 `https://yuxi.example.com`，不含路径、凭据、查询或片段。

客户端通过 `/api/system/ready` 检查连接，要求服务端版本与打包 Web 版本相同。连接失败、未就绪或版本不匹配时，本地状态页提供重新连接和实例设置入口。桌面版本与界面版本显示在设置和状态页中。

## 实例与登录

设置支持新增、编辑、测试连接、切换和确认删除。每个实例使用独立 Session；切换、删除当前实例或修改当前地址会关闭旧页面、取消在途请求并清理相关登录态，需要重新登录。仅修改名称保留当前页面。

主窗口只加载本地界面，HTTP(S) 外链交系统浏览器。OIDC 使用独立、无特权授权窗，截获当前实例的一次性登录码后交由本地 Web 完成登录。关闭授权窗或切换实例会取消登录。真实身份提供方的兼容性需要在部署环境验证。

macOS 原生菜单提供 `Cmd+W` 关闭当前窗口、`Cmd+M` 最小化和实例入口；点击 Dock 图标或选择“打开主窗口”可恢复主窗口。客户端使用单实例锁并保存可见窗口位置。设置与本地状态页跟随系统深浅主题。

## 测试

先构建界面，再运行真实 Electron 测试：

```bash
npm test
npm run build:renderer
npm run test:e2e
npm audit --audit-level=high
```

单测验证配置、隔离时序、IPC、协议、授权和发布拒绝条件。Electron 测试启动确定性 HTTP 对端并读取真实 DOM、会话、流与下载文件，覆盖桌面壳边界；服务端业务验证遵循[测试规范](../../docs/develop-guides/testing-guidelines.md)。设置浅深色、窄窗口和连接错误截图默认保存在测试临时目录，可通过 `YUXI_DESKTOP_ARTIFACT_DIR` 指定输出位置。

## 本地打包

```bash
npm run dist
```

产物在 `dist/`，架构跟随构建机器。基础配置显式关闭正式签名和公证，适合本机开发验证。CI 在 macOS 运行单测、Electron 测试及 `electron-builder --dir` 组装检查。

## 正式签名与公证

在 macOS 钥匙串安装 Developer ID Application 证书，配置以下环境变量后执行：

```bash
export CSC_NAME="Developer ID Application: Example Company (TEAMID)"
export APPLE_ID="release@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>"
export APPLE_TEAM_ID="TEAMID"
npm run dist:release
```

发布入口在开始构建前检查配置，启用强制签名、Hardened Runtime 和 Apple 公证。构建后验证当前架构应用的签名团队、公证票据与 Gatekeeper，任一失败都会退出。产物写入 `dist/release-<arch>/`，命令只生成本机产物。分发前需要在另一台 Mac 验证安装、首次启动、登录、文件和流式会话。
