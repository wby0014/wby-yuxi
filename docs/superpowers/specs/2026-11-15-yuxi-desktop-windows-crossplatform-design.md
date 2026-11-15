# Yuxi 桌面客户端 Windows 跨平台化设计（第一阶段）

- 日期：2026-11-15
- 状态：已确认（待进入实现计划）
- 范围：第一阶段仅 Windows x64

## 背景

`packages/yuxi-desktop` 已完成 macOS 客户端：Electron 壳本地打包 `web/dist`，通过 `app://yuxi` 提供静态资源与 SPA 回退，把 `/api/*`、`/minio/public/*` 流式转发到选中实例，实例隔离、OIDC 登录、签名公证发布均已落地。本设计把同一客户端扩展到 Windows。

关键技术事实（已核对源码）：

- 主进程代码已基本跨平台。`src/main/menu.js` 用 `process.platform === 'darwin'` 决定是否加 `appMenu` role，非 mac 有 else 分支；`src/main/index.js` 的 `window-all-closed` 已按非 darwin 退出；文件路径全部走 `node:path`，无硬编码 `/`。
- 真正的缺口在打包层：`electron-builder.yml` 只有 `mac:` target（dmg/zip），无 `win:`/`linux:` 配置，且 `build/` 图标目录不存在，当前 mac 产物实际使用 Electron 默认图标。
- `src/main/release.js` 的非 darwin 抛错是 mac 签名专用入口，不影响 Windows 第一阶段的无签名构建；`npm run dist` 已按当前平台构建，无需改 scripts。

## 目标与非目标

### 目标（第一阶段，Windows x64，可验证）

- `npm start` 在 Windows 能运行；`npm run dist` 产出 NSIS 安装包与 zip 便携版。
- 现有单元测试与真实 Electron E2E 在 Windows runner 全绿。
- GitHub Actions 新增 Windows job，自动构建界面、跑测试、产出安装包并上传 artifact。
- 文档补充 Windows 构建、运行、打包与已知限制说明。

### 非目标

- Windows 代码签名 / SmartScreen 认证（需 EV/OV 证书）。
- 自动更新（electron-updater + update feed）。
- Linux / ARM 平台。
- 托盘、系统通知、深链、全局快捷键等原生增强。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 推进方式 | 分阶段：先跑通再完善 |
| 第一阶段平台 | Windows x64 |
| 代码策略 | 方案 A：薄改动 + 打包优先 |
| Windows CI | 纳入第一阶段，与 macOS job 并列 |
| 平台门控 | 第一阶段不引入 `platform.js` 抽象，保留现有 3 处内联 `process.platform` |

平台门控的取舍：仓库内 `process.platform` 只有 3 处且语义互不相同（菜单 appMenu、非 mac 退出、mac 签名门控），第一阶段引入抽象是过度设计。等第二阶段做 Linux/托盘/通知、平台差异真正多起来时，再收敛为 `src/main/platform/` 目录。

## 改动清单

主进程架构保持不变（`application/instances/protocol/proxy/oidc/security/headers/menu/window-state` 边界不变），改动只落在打包、图标、CI、文档四块：

| 文件 | 改动 |
|---|---|
| `electron-builder.yml` | 新增 `win:` target（`nsis` + `zip`）与图标引用 |
| `build/icon.png`（新增） | 512×512 源图标，electron-builder 自动转出 `.ico`/`.icns` |
| `.gitignore` | 移除对 `build/` 的忽略，使图标作为源资产可提交 |
| `.github/workflows/desktop.yml` | 新增 `windows` job |
| `README.md` 及新文档 | Windows 构建、运行、打包、签名、已知坑说明 |

不改 `package.json` 的 scripts、主进程各模块与 `release.js`。`release.js` 保持 mac 签名专用，Windows 签名与公证在后续阶段按平台分支处理。

图标源需从 `web/public` 的 favicon 或 README 现有 logo 提取，落地为 `build/icon.png`（512×512）。当前 `.gitignore` 忽略 `build/`，需一并解除，使该图标目录作为源资产提交。

## 打包配置

`electron-builder.yml` 追加：

```yaml
win:
  target:
    - nsis
    - zip
  icon: build/icon.png
```

现有 `appId`、`productName`、`files`（`src/**`、`renderer/**`）与 `buildResources: build` 跨平台生效，无需改动。NSIS 使用 electron-builder 默认（单步安装），第一阶段不配置安装路径、升级码等发布细节。

## Windows CI

在 `.github/workflows/desktop.yml` 新增 `windows` job，与 macOS job 共享同一 `paths` 触发（`packages/yuxi-desktop/**`、`web/**`、工作流自身）：

```yaml
windows:
  name: Windows Electron and package smoke
  runs-on: windows-latest
  timeout-minutes: 25
  steps:
    - uses: actions/checkout@v7
    - uses: pnpm/action-setup@v6
      with: { version: 11.24.0 }
    - uses: actions/setup-node@v7
      with:
        node-version: 22
        cache: npm
        cache-dependency-path: packages/yuxi-desktop/package-lock.json
    - run: pnpm install --frozen-lockfile
      working-directory: web
    - run: npm ci
      working-directory: packages/yuxi-desktop
    - run: npm test
      working-directory: packages/yuxi-desktop
    - run: npm run build:renderer
      working-directory: packages/yuxi-desktop
    - run: npm run test:e2e
      working-directory: packages/yuxi-desktop
    - run: npx --no-install electron-builder --win --publish never
      working-directory: packages/yuxi-desktop
    - uses: actions/upload-artifact@v6
      with:
        name: windows-installer
        path: packages/yuxi-desktop/dist/*.exe
        if-no-files-found: ignore
```

macOS job 用 `--dir` 做 smoke 是因为 dmg+签名慢；Windows 第一阶段无签名、NSIS 构建快，直接做完整 `--win` 构建，`*.exe` 即交付物。Windows runner 原生跑 NSIS，无需 wine；首次会联网下载 NSIS/winCodeSign 工具，由 GitHub 缓存。

## 测试与验证

三层验证对应"跑通"的完整定义：

1. 单元测试（`npm test`）：验证平台无关逻辑在 Windows 上无路径/文件系统坑，重点是 `routeRequest` 的 `path.sep` 判断与 `instances-store` 的原子写。
2. 真实 Electron E2E（`npm run test:e2e`）：playwright 驱动真 Electron，对确定性 HTTP 对端验证 `app://` 加载、API 转发、SSE 流、上传下载、OIDC code 流、实例切换与 session 隔离。
3. 打包（`electron-builder --win`）：产出 NSIS + zip，上传 artifact。

另加一步手动 smoke（写进文档，不自动化）：真实 Windows 机器装 NSIS → 连真实 Yuxi 实例 → 验证流式会话、下载、OIDC。合成对端覆盖不了的真实 TLS、真实 IdP、真实流式服务器由这步兜底。

验收 = Windows job 全绿 + `*.exe` artifact 产出 + 手动 smoke 文档记录。

## 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `node --test test/*.test.js` 的 `*` 在 Windows 不被 shell 展开 | 单测/E2E 跑不起来 | Node 22 的 `--test` 自带 glob，实测；不行改 `node --test test/` 目录发现 |
| `fs.renameSync` 覆盖已存在文件在 Windows 偶发 `EPERM`/`EEXIST` | 实例配置写入失败 | 现有 store 测试在 Windows 上验证；如需 rename 前 `rmSync(target,{force:true})` 兜底 |
| 图标缺失 | NSIS 构建失败或落到默认 Electron 图标 | 从 `web/public` favicon 或 README logo 提取 512×512 PNG 放入 `build/` |
| E2E 的相对路径与临时目录假设 | Windows 上定位失败 | `path.resolve` 跨平台安全，跑通即验证，低风险 |
| 未签名 exe 触发 SmartScreen | 终端用户被拦 | 预期行为，第一阶段无证书，写进已知限制；CI 不受影响 |
| 首次 CI 下载 Electron/NSIS 工具 | 首跑变慢 | GitHub 缓存 + `timeout` 放宽，非阻塞 |

## 后续

- 实现前按 Yuxi 仓库约定（根 `AGENTS.md` 与 spec-loop）在 `docs/develop-guides/decisions/proposed/` 补 tracked decision 记录；本 spec 是设计文档，decision 是仓库要求的独立产物。
- 本 spec 确认后进入 writing-plans，产出分步实现计划。
