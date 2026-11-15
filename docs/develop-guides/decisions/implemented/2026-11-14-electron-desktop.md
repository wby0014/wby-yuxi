# Electron 远程服务型桌面客户端

状态：implemented
类型：architecture
Owner：desktop/src/main.ts

## 问题

预定读者是 Yuxi 开发者与客户端发布维护者。页面类型是技术设计与架构决策，前置知识是仓库根 `ARCHITECTURE.md` 中的系统边界与 [测试分层](../../testing-guidelines.md)。目标是在一个仓库内发布 Windows/macOS 桌面客户端，同时复用现有 Vue 业务界面和远程后端。

用户明确要求第一版不包含 Agent 读写本地目录的能力。桌面端也不暴露命令执行、本地 MCP、任意文件系统或 Node API。客户端自身保存服务地址、加密登录凭据，以及用户明确触发的浏览器上传/下载，不属于 Agent 本地执行能力。

## 决策

### 实现方案

仓库保留 `backend/` 与 `web/`，增加独立的 `desktop/` Node 工程。Electron 主进程与 preload 使用 TypeScript；现有 Vue 前端保持 JavaScript。桌面端将 `web` 的构建产物一起打包，运行时只连接用户配置的远程服务，不装配 Python、worker、数据库或 Docker。

| 组件 | 职责 | 边界 |
|---|---|---|
| Vue renderer | 现有登录、Agent、知识库、SSE、上传与预览 | 无 Node、无通用 IPC |
| preload | 服务配置和会话的有限接口 | 只在主 frame 暴露，参数与调用方由 main 再校验 |
| Electron main | 窗口、原生菜单、外链、下载确认、配置持久化 | 不拥有业务授权、Agent 编排或 shell 执行 |
| 同源协议网关 | `app://yuxi/` 本地资源与受限 `/api`、`/minio/public/` 转发 | 仅当前配置的服务，不提供任意 URL 代理 |
| FastAPI / worker | 原有业务、权限、Agent 执行与状态 | 保留现有 PostgreSQL / Redis / ARQ 边界 |

客户端入口固定为 `app://yuxi/`。生产环境从安装包提供前端；开发环境的静态资源转发至固定 loopback Vite 服务，API 仍经过同一协议网关。Vue history 路由的无扩展名页面返回入口文件，未知静态文件返回 404。路径解码、目录边界和协议 host 均在 main 校验。

### 服务配置与网络

首次启动展示服务配置页；之后通过桌面界面的“服务设置”修改。地址只接受根 origin：HTTPS，或 loopback 的 HTTP；拒绝用户名密码、路径前缀、query、fragment 和非 HTTP(S) 协议。这里采用 HTTPS 生产约束，私有网络的纯 HTTP 部署需先配置 TLS 反向代理。

远程服务入口必须同时提供 `/api` 与 `/minio/public/`，与现有 Nginx 公网入口一致。前端继续使用相对路径，普通请求、直接 fetch 的 SSE、上传和对象资源不会各自维护另一份 base URL。网关保留 bearer 与业务响应头，剔除 hop-by-hop 和 cookie 头；响应流不聚合，取消请求传播到上游。重定向仅允许当前服务的 API/公共对象路径，并改写为本地协议地址；拒绝跨 origin 重定向，防止凭据被转发。API 错误不输出令牌、完整 URL 或上游内部诊断。网关不设置覆盖整个上传或等待首响应阶段的固定总时限，采用底层 HTTP 传输超时；用户取消与服务切换会主动中止上游。

切换服务需要原生确认。main 销毁旧 renderer、取消旧请求、清空当前会话和该应用 origin 的浏览器存储/缓存后，启动新 renderer；旧 renderer 不会携带旧 token 向新服务发请求。仅保存一个当前服务，不新增多账号配置管理系统。

### 登录态

Web 继续使用现有 localStorage。桌面端在启动前通过 preload 恢复会话，运行时 token 保留在 renderer 内存；持久化由 main 的 `safeStorage` 加密后写入应用专用配置文件。配置写入采用临时文件与 rename，文件权限限制为当前用户。退出登录立即清除内存，异步清除磁盘凭据；失败向 UI 告警。不得把桌面 token 写入 localStorage。

系统安全存储不可用，或 Linux 使用 `basic_text` 后端时，只保留进程内会话并显示说明，不降级为明文持久化。加密保护静态存储，不承诺防御同用户恶意进程或已攻陷的 renderer。服务地址变更必定清除旧凭据。

第一版支持现有账号密码登录与管理员初始化。OIDC 的外部浏览器回调和桌面授权握手不在范围内；桌面端隐藏 OIDC 入口并显示账号密码登录说明，Web 的 OIDC 行为保持不变。

### 安全与内容预览

窗口使用 `nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`，禁止 webview 和所有未显式授予的权限。IPC 只接受当前主窗口的 main frame，且必须位于受信任的本地 UI URL。preload 不暴露 `ipcRenderer`、`fs`、任意 URL 请求或执行命令。

主窗口不导航到远程站点或 API 文档；外链只允许 HTTP(S)，经原生确认后交给系统浏览器。API/对象响应禁止作为可执行应用文档使用。生产 CSP 的脚本来源限定为打包 assets，防止服务返回的同源 JS 被当作桌面代码执行。

现有 Agent HTML 继续放在 `sandbox="allow-scripts"` 的 iframe 中。桌面 CSP 禁止内联和远程脚本，因此第一版只保证静态 HTML 预览与源码查看，不执行 Agent 生成脚本或其 CDN 脚本；该限制不修改 Web 行为。Markdown、图片、PDF 预览仍需在安装包内验证。所有 iframe 均无 preload bridge。

### 工程与发布

`desktop/` 独立使用 npm lockfile；`web/` 保留原 pnpm lockfile，避免为桌面端引入仓库级 workspace 改造。构建先产出 desktop 专用的 Web dist，再由 esbuild 编译 main/preload，electron-builder 打包。Windows 目标 NSIS，macOS 目标 DMG；本地 `--dir` 可验证打包装配，不等于签名或真实安装验证。

第一版采用手动下载安装新版本。自动更新 feed、证书、macOS 公证和生产发布权限未提供，不启用假地址或自动发布。构建脚本和 CI 不写入密钥。默认图标可用于开发验收，正式发布前补产品图标、签名、公证和安装升级回归。

## 替代方案

- 直接加载远程网站：开发快，但远程网页与桌面权限的生命周期绑定；选用随包发布的可信前端。
- 复制独立桌面 Vue 工程：会复制业务和修复；选用共享前端和小型平台适配。
- 每个前端调用拼接远程 base URL：遗漏 SSE、预览和对象资源的概率高；选用受限同源协议网关，接受新增网关测试成本。
- 第一版内嵌后端或本地 Agent：要求独立设计持久化、执行授权和升级；不纳入第一版。

## 验证

2026-11-14 在 macOS arm64、Node.js 25.8.2 上执行下列验证。桌面工程最低 Node.js 24，macOS/Windows Node.js 24 CI 已配置，远程 CI 本轮未执行。

| 验收主张 | 失败面 | 语义 Owner | 直接证据 / 命令 | 负向案例 | 当前结果 |
|---|---|---|---|---|---|
| 地址与应用资源不能越界 | 任意协议、远程 host、编码目录穿越 | `desktop/src/policy.ts`、`gateway.ts` | `npm --prefix desktop test`，11/11，包括真实 HTTP 集成 | 非 loopback HTTP、凭据 URL、编码越界、缺失资产 | Passed |
| 令牌不明文落盘且按服务隔离 | 明文 fallback、跨服务复用 token | `desktop/src/profile.ts`、`main.ts` | profile 单测与 `npm --prefix desktop run test:smoke` | 不安全存储、写入失败；切换服务后 token 和草稿为空，第二服务未接收旧认证头 | Passed |
| API、上传与 SSE 使用配置服务 | 请求体丢失、缓冲、过早超时、取消失效 | `desktop/src/gateway.ts` | 真实 loopback HTTP 集成与 Electron stub，包含 31 秒上传、慢首响应、307 POST 重放 | 跨 origin redirect、SSE 取消、切换服务中止 pending 请求、503 | Passed |
| renderer 与 iframe 不获得通用本地能力 | iframe 取得 bridge、远程脚本执行、危险外链 | preload、main、policy | 调用方校验单测与真实 Electron smoke | 子 frame/外部 sender、file/javascript URL、API JS 被 CSP 阻断、iframe 无 bridge、renderer 无 require | Passed |
| Web 会话适配保持可用 | token 恢复和 UI 门控回归 | `web/src/platform/runtime.js`、user store | `pnpm --dir web run test:unit` 401/401、`lint:check`、`build` | 浏览器无 bridge 保留原存储；桌面切用户刷新恢复、持久化失败不刷新 | Passed |
| macOS arm64 目录包装配完整 | main/preload/Web assets 缺失、asar 边界错误 | desktop build 与 protocol | `npm --prefix desktop run package:dir`；检查 asar 814 项；启动真正打包的原生可执行文件 | 仅含 dist、web-dist、package.json，不含后端/应用配置；临时 userData 首屏、bridge、无 Node 验证 | Passed |
| 开发入口正确管理自有进程 | 误载其他服务、退出残留进程 | `desktop/scripts/dev.mjs` | 实际启动 Vite 与 Electron，回读 Vue main 入口；同一真实窗口 smoke 通过开发协议网关；SIGTERM 后对比进程与监听者 | 退出后自有 Electron/Vite 均结束，既有 Docker listener 未变化 | Passed |
| 新增 UI 的可见页面完整 | 空白截图、深色对比度、最小窗口溢出 | `DesktopConnection.vue`、Electron smoke | 真实窗口截图并人工查看；见系统临时目录 `yuxi-desktop-qa/` | 浅/深色首次配置、960×640、无安全存储提示、无效地址、设置弹窗、目录包首屏 | Passed |
| 文档与工程契约一致 | 失效相对链接、决策格式或工程契约回归 | 决策记录与工程 verifier | `pnpm --dir docs run build`、`python3 scripts/verify_engineering_contracts.py`、`python3 -m unittest scripts.test_verify_engineering_contracts` 63/63、`git diff --check` | 文档链接检查与工程负向 fixtures | Passed |
| 真实 Yuxi 业务与平台分发 | 部署差异、OS 密钥链、安装/升级失败 | 远程服务与平台环境 | 客户端 README 的人工验收清单 | 真实登录/过期/重启、Agent 取消/审批、MinIO/PDF/下载、Windows、签名/公证/升级 | Not run |

真实窗口 smoke 使用本地 HTTP stub，明确模拟安全存储不可用和切换服务原生确认的肯定响应；它不证明真实 Yuxi 业务或 OS 密钥链加解密。真实 macOS 目录包仅验证独立配置下的启动与首屏，未进行 DMG 安装、正式分发、Windows 构建或安装升级验证。

后端源码与部署未改动，未运行 Compose 后端单测，不将客户端验证扩展为后端业务验收。独立代码审查发现的锁文件忽略、PDF worker MIME、切用户会话接入、长上传超时均补充回归并修复。

## 后果

- 同源网关增加上传、SSE 与重定向的维护面；以真实 HTTP 流测试覆盖，不关闭 webSecurity 或全局 CORS。
- 服务需配置 HTTPS 与公共对象反向代理；纯 HTTP 远程地址被客户端拒绝。
- OIDC-only 部署、离线运行、生成脚本执行、自动更新和生产签名不在第一版交付范围内。
- 未连接真实 Yuxi 时只能证明客户端装配与协议行为，不能声明业务链路验收通过。

## 参考

- [Electron 进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)
- [Electron 自定义协议](https://www.electronjs.org/docs/latest/api/protocol)
- [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
- [electron-builder](https://www.electron.build/)
