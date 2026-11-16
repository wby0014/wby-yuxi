# 桌面客户端隔离、协议适配与发布验证

状态：implemented
类型：bug-fix
Owner：packages/yuxi-desktop/src/main/application.js

## 问题

桌面端删除当前实例后立即改变代理目标，却保留原窗口和登录态。静态协议缺少 PDF 模块 Worker 的 MIME，外链全部被拒绝，OIDC 会离开本地页面。自定义菜单缺少原生关闭角色，导致 Cmd+W 无法关闭窗口。现有测试只覆盖纯函数，没有覆盖实际 Electron 协议、窗口和授权。打包复制既有 Web 产物，签名、公证和安装验证没有形成发布门禁。

## 决策

### 实现方案

桌面主进程拥有实例变更和窗口生命周期。每个实例使用独立持久 Session，窗口及其协议处理器绑定不可变实例地址；实例切换、当前实例删除和地址更新串行执行，关闭旧窗口和授权、清理相关登录态后创建新窗口。实例编辑、连接测试和首次配置在独立设置页完成。

原生菜单由 `src/main/menu.js` 装配 Electron 的文件和窗口角色，沿系统菜单机制注册 Cmd+W 关闭与 Cmd+M 最小化。主窗口关闭或最小化后沿既有 activate 入口恢复。

协议层验证 app origin，提供正确静态 MIME、SPA 回退与流式 HTTP 转发。单个请求的网络错误返回 502，保留当前页面与未保存编辑；启动 readiness 失败和渲染进程退出使用本地状态页。主窗口导航限定在 app origin，安全 HTTP(S) 外链交系统浏览器；独立、无 preload 的 OIDC 窗口拦截当前实例的一次性回调码，再由本地 Web 沿既有 exchange-code API 完成登录。IPC 在执行副作用前验证发送窗口及顶层 frame。窗口位置配置只接受 JSON 对象，其他 JSON 值按缺省位置恢复。

构建入口先构建 Web，再复制产物并记录前端版本。桌面测试和依赖审计接入 CI；Electron 集成测试使用真实桌面运行时及确定性 HTTP 服务验证壳边界，服务端主链路由既有真实系统测试验证，桌面连接真实部署的业务主链路需要对应账号和服务环境。正式发布脚本要求签名、公证凭据并验证产物；本地开发构建明确不宣告正式签名成功。

打包复用 npm 锁定并参与 Electron 回归的本机运行时。构建依赖中存在拒绝服务缺陷的 minimatch 7–10 通过范围 override 固定到 11.0.1，保留旧版可调用函数接口的 3/5 consumer。当前 Builder 的文件筛选与实际应用归档验证该替换；依赖审计覆盖 Electron 所在的开发依赖集合。

## 替代方案

- 保留共享 Session 并只补删除后的 reload：不能隔离旧页面内存态、在途请求和并发切换。
- 新建桌面后端认证协议：增加服务端兼容面；现有 OIDC 一次性码已满足桌面登录。
- 直接加载远端 Web：放弃当前本地打包约定，增加对远端页面与特权桥组合的信任面。

## 验证

| 验证 | 结果与边界 |
|---|---|
| 桌面 `npm test` | 35 项通过，包含未知实例、非法地址、非可信 sender、错误回调、版本不匹配、磁盘失败、离屏窗口、非对象位置配置和错误签名团队的拒绝条件；代理请求失败保留当前页面 |
| 桌面 `npm run test:e2e` | 13 项通过，回读实际 Electron 中的登录态、实例 cookie、PDF 模块、上传字节、SSE 首包、下载文件、隔离 iframe、授权回调、实例配置与窗口；验证删除和地址编辑清会话、在途响应取消、未就绪重连及并发恢复；读取原生 Cmd+W/M 菜单绑定并验证窗口关闭、最小化和 activate 恢复；浅深色和窄窗口截图已检查 |
| Web `npm run lint:check`、`npm run test:unit`、桌面 `npm run build:renderer` | lint、396 项单测和当前源码构建通过 |
| `docker compose exec -T api uv run --no-sync --group test pytest test/unit -m 'not slow' -q` | 2465 项通过、62 项跳过；规范中的同步依赖命令因容器安装目录权限失败，此命令复用已安装依赖 |
| 工程契约及其单测、依赖与发布策略测试 | `verify_engineering_contracts.py` 通过；`scripts.test_verify_engineering_contracts`、`scripts.test_dependency_update_policy`、`scripts.test_release_workflows` 共 73 项通过 |
| docs `npm run build` | 文档构建与站内链接检查通过 |
| 桌面 `npm audit --registry=https://registry.npmjs.org --audit-level=high` | 0 项漏洞 |
| `npx --no-install electron-builder --dir --publish never` | 本机 arm64 应用组装通过；实际 app.asar 包含当前源码、PDF Worker 和版本元数据，不包含测试与构建依赖 |

真实 Apple 签名与公证、外部 OIDC provider、另一台 Mac 安装、桌面连接真实后端的业务主链路和 GitHub Actions 运行结果为 Not run；当前环境没有相应发布凭据、外部身份配置、另一台机器与桌面业务测试账号。确定性 HTTP 对端只证明桌面边界，不能替代 PostgreSQL、worker 和真实身份服务结果。

窗口快捷键回归读取真实 MenuItem 的角色、accelerator 和启用状态，再验证对应原生窗口操作的最终状态；移除文件菜单时因缺少 Cmd+W 绑定失败。该测试未注入 macOS 物理按键事件。

2026-11-15 的提交复核中，工程契约、73 项工程及策略测试、Web lint、桌面界面构建和文档构建通过；Web 单测为 395 项通过，PDF 资产用例因 loopback 监听被拒绝而失败。Electron E2E 同样因 loopback 监听被拒绝而未进入窗口用例，后端测试因 Docker socket 权限被拒绝而未执行；表中的完整 Electron 与后端结果保留先前环境的验证记录，不代表本轮重跑通过。两项窗口与网络错误修复均先由新增回归用例复现，再通过单测验证。

## 后果

独立 Session 首次使用及实例变更需要重新登录。客户端只支持与打包 Web 版本相同的服务端版本；缺少兼容性协商契约时，连接页明确拒绝版本不匹配，避免陈旧界面继续发起不兼容请求。真实 OIDC provider、Apple Developer 凭据和另一台 Mac 的安装结果依赖外部环境，不能由单测或本机打包替代。托盘、通知等额外原生能力仅在已有用户场景需要时加入；Windows/Linux、自动更新、Keychain 和本机工具执行保持原设计范围。

导航与主 IPC 当前按 app origin 授权，尚未独立区分同源代理文档与打包页面；该已有边界局限需要后续单独收紧，并通过真实窗口导航验证。
