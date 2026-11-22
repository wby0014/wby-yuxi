# Electron 与 Tauri 共用桌面界面

状态：proposed
类型：feature
Owner：packages/yuxi-desktop-tauri/src-tauri/src/lib.rs

## 问题

需要同时运行和维护 Electron、Tauri 两种桌面客户端，并复用现有 Vue 业务。现有窗口桥接、设置页和构建入口属于 Electron；直接复制会使登录、实例管理和品牌配置形成两份可独立修改的行为。

## 提案

### 实现方案

保留 `packages/yuxi-desktop`，新增 `packages/yuxi-desktop-tauri`。`web/src/platform` 拥有网页消费的桌面接口与流式传输选择；共享的设置、状态界面位于 `web/desktop`，两种宿主分别执行原生副作用。构建辅助共用品牌与前端版本来源，但输出目录、应用 ID、数据目录和签名产物独立。

Tauri Rust 核心拥有实例持久化、窗口、readiness、授权与固定实例 HTTP 转发。业务请求由原生命令 open/read/cancel 传输，页面编码 multipart 并按背压读取标准 Response，SSE 保持增量；直接加载的资源经自定义协议缓冲转发。请求绑定创建时的实例并支持取消，每个主窗口拥有独立 Cookie jar。代理文档不能导航为有原生权限的主页面；原生命令检查窗口身份与本地页面来源，授权窗口不获得应用命令权限。

主窗口使用非持久 WebView，关闭、切换和编辑当前地址均销毁会话，重建窗口重新登录；实例配置独立持久化。该选择避免复用尚未异步清理完成的 WebView 数据存储，代价是关闭主窗口后不保留登录态。下载仅接受本地 Blob，保存到系统下载目录并生成避免覆盖的文件名。

一期与现有客户端一致面向 macOS，接入实例新增、编辑、删除、切换、登录和文件/流式访问；自动更新、Windows/Linux、本机 Agent 执行和两种应用间自动迁移数据不在本期范围。

## 替代方案

- 复制 Web 与设置页面：维护两份业务和展示事实，后续修复容易遗漏。
- 删除 Electron：不满足两种客户端并存的要求。
- 在 Tauri 附带 Node.js sidecar 运行现有主进程：增加运行时和发布成本，原生隔离仍需改写。

## 验收标准

| 验收主张 | 失败面 | 语义 Owner | 直接证据 / 命令 | 负向案例 | 当前结果 |
|---|---|---|---|---|---|
| 共享平台接口保持浏览器与 Electron 行为 | 页面散落框架判断或浏览器回归 | web/src/platform | 共享接口 unit、Electron unit/E2E | 错误授权结果、原生字符串错误 | Passed |
| 独立 Tauri 实例与持久化 | 无效配置、写盘失败、串实例 | Tauri instances 与 transport | cargo test；协议和命令测试 | 非法 URL、损坏配置、旧实例取消 | Not run |
| SSE 保持增量与取消 | 等待完整响应、关闭后继续写入 | Rust transport 与 Web stream adapter | Rust HTTP 测试、JS ReadableStream 回读 | 延迟后续 chunk、主动 abort | Not run |
| 原生权限限定本地受信窗口 | 代理内容和授权页面调用应用命令 | Tauri capabilities、窗口校验 | Rust 边界测试、宿主集成 | 远端来源、错误窗口、代理路径 | Not run |
| 两种应用独立构建与分发 | 覆盖产物、品牌漂移、身份冲突 | 共享构建辅助及各宿主配置 | 独立 renderer 构建、元数据回读、Electron 品牌 E2E、Tauri 构建 | 相同输出目录、错误配置 | Not run |

2026-11-21 提交前验证使用已有 Node 依赖运行 npm 脚本，本机未安装 pnpm。实际命令与结果如下：

| 执行位置 | 命令 | 结果与观察边界 |
|---|---|---|
| 仓库根目录 | `python3 scripts/verify_engineering_contracts.py` | Passed，工程契约检查 |
| 仓库根目录 | `python3 -m unittest scripts.test_verify_engineering_contracts` | Passed，63 项 |
| `web` | `npm run lint:check` | Passed |
| `web` | `npm run test:unit` | Passed，405 项；沙箱内因监听端口受限失败，允许监听端口后完整重跑通过 |
| `packages/yuxi-desktop-tauri` | `npm test` | Passed，9 项；回读 JS 背压、迟到响应释放、abort 和 multipart 字节 |
| `packages/yuxi-desktop` | `npm test` | Passed，39 项 |
| `packages/yuxi-desktop` | `npm run test:e2e` | Passed，14 项；真实 Electron 回读 DOM、实例会话、流与下载字节，包含品牌、主题及窄窗口截图 |
| 两个桌面模块 | `npm run build:renderer` | Passed，回读独立目录的品牌及版本元数据、本地页面与 PDF Worker 文件 |
| `packages/yuxi-desktop` | `npx --no-install electron-builder --dir --publish never` | Passed，无签名应用组装，回读应用包展示名与 app.asar 文件 |
| 仓库根目录 | `docker compose exec api uv run --no-sync --group test pytest test/unit -m "not slow"` | Passed，复用容器现有依赖，2473 项通过、62 项跳过；跳过项不计为功能通过 |
| `docs` | `npm run build` | Passed，文档及链接构建 |
| 仓库根目录 | `git diff --check` | Passed |

这些结果不证明 Rust 编译、Tauri 命令调用或原生 WebView 行为。后端标准命令 `docker compose exec api uv run --group test pytest test/unit -m "not slow"` 在同步依赖时因容器内 site-packages 文件权限失败。

## 风险

macOS WebView 的自定义协议、上传、下载落盘、PDF Worker、HTML sandbox 和真实 OIDC provider 需要真实宿主验证。当前执行环境未发现 Rust 工具链，npm 与 Rust 下载域名解析失败；`cargo test` 因缺少 cargo 未执行，依赖锁文件尚未生成。macOS CI 配置编译、Rust 测试和无签名应用组装，依赖审计覆盖新增 npm/Rust 依赖；这些配置不能代替实际通过证据，提案在原生验收完成前保留 proposed。

上传在页面编码后通过 IPC 传递完整请求体，大文件有内存开销；自定义协议资源响应也会完整缓冲。Tauri 正式签名、公证、跨机器安装和锁定依赖后的可重复构建仍未验收。
