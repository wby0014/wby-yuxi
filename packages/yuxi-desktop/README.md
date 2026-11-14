# yuxi-desktop

Yuxi 的 macOS 桌面客户端。用 Electron 壳**本地打包** `web/dist`，通过自定义 `app://` 协议复刻生产 nginx 行为：静态资源 + SPA 回退 + 把 `/api/*`、`/minio/public/*` 转发到「当前选中的 Yuxi 实例」。支持配置多个实例，签名公证后手动分发。

## 目录结构

```
src/main/        Electron 主进程（协议转发、IPC、菜单、窗口）
src/preload/     渲染进程 preload 桥（contextBridge）
src/settings/    实例设置窗口（独立小页）
renderer/        构建时从 ../../web/dist 拷贝（gitignore）
test/            node:test 单元测试
```

## 前置条件

- Node.js ≥ 20、npm
- macOS（当前仅支持 macOS）
- 一个运行中的 Yuxi 实例（本地 `docker compose up` 或远程部署）

## 开发运行

```bash
# 0. 先构建前端（首次需 npm install）
cd ../web && npm install && npm run build

# 1. 复制前端产物到 renderer/
cd ../packages/yuxi-desktop && npm run build:renderer

# 2. 启动桌面客户端
npm start
```

首次启动会弹「请先配置实例」，填实例地址：

- 本地 dev 拓扑：`http://localhost:5173`（Vite dev，同源代理 `/api` 和 `/minio/public/`）
- 只测 API：`http://localhost:5050`
- 生产：部署域名，如 `https://yuxi.example.com`

## 测试

```bash
npm test   # 即 node --test，自动发现 test/*.test.js
```

## 打包（无签名 dev 构建）

```bash
npm run dist
```

产物在 `dist/`：`Yuxi Desktop.app`（`dist/mac-arm64/`）、`-arm64-mac.zip`、`-arm64.dmg`。

### ⚠️ 两个网络相关的坑

1. **Electron 二进制下载需要镜像**。默认 CDN 在本环境 `fetch failed`，安装/打包都要带 `ELECTRON_MIRROR`：

   ```bash
   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
   ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm run dist
   ```

2. **dmg 目标末尾可能卡在 `Timeout awaiting 'request' for 600000ms`**（网络超时）。`zip`/`.app` 不受影响；dmg 可用 `hdiutil` 本地补：

   ```bash
   hdiutil create -volname "Yuxi Desktop" \
     -srcfolder "dist/mac-arm64/Yuxi Desktop.app" \
     -ov -format UDZO "dist/Yuxi Desktop-0.1.0-arm64.dmg"
   ```

## 签名 + 公证

编辑 `electron-builder.yml`：取消 `mac.identity` 注释填入 Developer ID Application 证书全名，`mac.notarize: true`；再导出环境变量后 `npm run dist`：

```bash
export APPLE_ID="your@email.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```
