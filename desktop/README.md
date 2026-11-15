# Yuxi Desktop

Electron 桌面客户端，复用 `../web`，连接远程 Yuxi 服务。第一版不含 Agent 本地目录访问、命令执行、本地 MCP 或内嵌后端。

## 开发

需要 Node.js 24+、pnpm（版本以 `../web/package.json` 为准）和当前平台的 Electron 构建环境。以下命令从仓库根目录执行：

```bash
pnpm --dir web install --frozen-lockfile
npm --prefix desktop ci
npm --prefix desktop run dev
```

开发态固定使用 `127.0.0.1:5173`，端口被占用时退出，不连接已有的其他开发服务。renderer 的 Vue 修改由 Vite HMR 生效；main/preload 修改后重启 dev 命令。`dev` 会打开真实应用窗口。

首次启动填写服务根地址，如 `https://yuxi.example.com`。该入口需代理 `/api` 和 `/minio/public/`（与现有 Nginx 入口一致）；不要填写 `/api`，也不要直接填写缺少对象代理的 API 容器地址。仅 loopback 调试允许 HTTP，例如 `http://127.0.0.1:5050`。普通远程服务需要 TLS。

第一版支持账号密码登录。仅支持 OIDC 的部署先使用 Web 版。通过“服务设置”切换服务时会退出账号并清除客户端缓存、设置和草稿；远程数据不会删除。系统安全存储不可用时会话仅存于本次应用进程，不明文持久化。

## 验证

```bash
npm --prefix desktop test
npm --prefix desktop run typecheck
pnpm --dir web run lint:check
pnpm --dir web run test:unit
npm --prefix desktop run build
npm --prefix desktop run test:smoke
```

smoke 会打开真实 Electron 窗口，使用临时本地 HTTP stub 验证配置页、登录页、上传与 SSE、CSP、iframe bridge 隔离和服务切换。它不连接生产服务；自动化明确将系统安全存储模拟为不可用，真实 OS 密钥链不是其已验证范围。截图默认写入系统临时目录的 `yuxi-desktop-qa/`，可用 `YUXI_QA_DIR` 指定输出目录。

桌面端 CSP 禁止生成 HTML 的内联/远程脚本，保留静态预览与源码查看。此限制不改变 Web 版预览行为。PDF、图片、Markdown 和真实对象下载仍需按下文人工检查。

## 打包

```bash
# 当前平台的未签名目录包
npm --prefix desktop run package:dir
# 当前平台安装包：macOS DMG 或 Windows NSIS
npm --prefix desktop run package
```

输出位于 `desktop/release/`。安装包只包含编译的 main/preload、Web assets 与 Electron 运行时，不包含后端、配置文件或 token。构建不发布安装包，也不注册自动更新源。正式分发需配置产品图标、平台签名证书和 macOS 公证；macOS 未签名测试包不能被当作面向用户的可分发版本。

## 人工验收

- Windows/macOS 实际安装、启动、卸载以及手动安装新版本。
- HTTPS Yuxi 的登录、退出、重启恢复会话、密码错误与 token 过期。
- Agent SSE、取消、工具审批、网络中断后的终态及恢复。
- 上传文件、MinIO 资源、图片、PDF、静态 HTML、Markdown 以及下载保存对话框。
- 切换服务后旧账户、缓存和草稿不可见，旧 token 不发向新服务。
- Windows/macOS 真实安全存储及 Linux 不安全后端的显式降级。
- 外部链接的系统浏览器确认、iframe 无 bridge、危险协议不能触发原生操作。

自动化结果、未运行范围与发布条件记录在[技术方案的验证部分](../docs/develop-guides/decisions/implemented/2026-11-14-electron-desktop.md#验证)。未连接真实 Yuxi、没有签名证书或未使用 Windows 时，不以单测/stub 结果替代这些验收。
