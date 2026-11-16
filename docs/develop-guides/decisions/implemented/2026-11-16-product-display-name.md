# Web 与桌面统一产品展示名称

状态：implemented
类型：feature
Owner：backend/package/yuxi/config/static/info.template.yaml

## 问题

部署者修改品牌信息后，浏览器标题、对话欢迎语与桌面原生入口仍出现固定的语析或 Yuxi 名称。目标是只修改现有品牌 YAML 的 `branding.name`，即可统一产品展示名称；组织名称允许独立配置。默认产品名由品牌配置提供。包名、应用 ID、协议、存储目录、模型提示词和开源项目链接不属于产品展示名称，本决定不迁移这些身份或数据。

## 决策

### 实现方案

后端 service 读取现有 `YUXI_BRAND_FILE_PATH` 或默认本地 YAML，缺失时使用模板；YAML 解析后将字符串中的 `{{PRODUCT_NAME}}` 替换为 `branding.name`，继续展开版本占位符。默认组织名与版权引用产品名。公开信息接口保持现有响应结构，配置错误显式失败。

Web 信息 store 拥有展示名，标题、首页、登录、侧栏和聊天欢迎语消费该值；配置未加载时使用通用标题。桌面构建从同一 YAML 读取名称，写入随包发布的构建信息，主进程与本地页面消费构建名称，打包配置同步生成应用名称。应用 ID、包名和既有 userData 路径保持稳定。Web 刷新读取服务端品牌，桌面原生名称在重建客户端后生效。

## 替代方案

逐个替换名称无法满足后续一处修改；新增独立品牌配置会与已有 YAML 形成两个来源；让桌面仅依赖服务端名称无法覆盖未连接时的本地页面与应用包。沿用现有配置并在桌面构建时读取，接受原生名称需要重建的限制。

## 验证

| 验收主张 | 失败面 | 语义 Owner | 直接证据 / 命令 | 负向案例 | 当前结果 |
|---|---|---|---|---|---|
| 单个名称值驱动 API 的名称、默认组织与版权 | 文本替换破坏 YAML 或漏替换 | 品牌 service 与 YAML | 相关后端 unit 11 项、公开 HTTP integration 1 项 | 含引号名称、空名称与缺失配置 | Passed |
| 页面名称与标题跟随接口变化 | 首次加载、刷新或聊天语仍使用固定名称 | Web info store 与页面 | Web lint、unit 396 项、build、Chrome 页面 | 自定义名称与延迟加载 | Passed |
| 桌面原生与本地页面读取相同构建名 | 原生菜单、离线页或产物名漏改 | 桌面构建与主进程 | 桌面 unit 39 项、Electron E2E 14 项、开发包回读 | 自定义品牌与既有数据路径断言 | Passed |

后端执行 `docker compose exec api uv run --no-sync --group test pytest test/unit/routers/test_system_router.py test/unit/services/test_branding_service.py -q -p no:cacheprovider`；真实 HTTP 执行同一解释器下的 `test/integration/api/test_system_router_api.py::test_info_endpoint_is_public`。提交前执行 `docker compose exec -T api uv run --no-sync --group test pytest test/unit -m 'not slow'`，2473 passed、62 skipped，包含最终的配置错误响应断言。容器同步依赖因系统 site-packages 权限失败，因此使用现有依赖的 `--no-sync`。Ruff 未运行：容器未安装该命令。

Web 执行 `npm run lint:check`、`npm run test:unit`；生产构建由桌面 `npm run build:renderer` 执行。`web/test/browser/branding.js` 在隔离 Chrome 上下文中检查首页、登录、聊天欢迎语和标题，覆盖延迟品牌响应、带引号和符号的名称，并回读浅/深色、1440px 与 375px 视窗截图。该浏览器测试使用确定性 API 对端；既有页面最小宽度约束保持原样。

桌面执行 `npm test`、`npm run test:e2e`、`npx --no-install electron-builder --dir --publish never`。回读开发包的构建名称、`CFBundleName`、应用 ID 与包内 metadata，确认展示名与品牌配置一致，技术身份仍为 `com.yuxi.desktop` 与 `yuxi-desktop`。正式签名、公证与跨机器安装未运行，需发布环境验证。

## 后果

已有本地 YAML 的固定组织名和版权继续表示部署者的显式选择；希望自动跟随产品名时需要改成占位符。桌面连接其他品牌的实例时，页面遵循实例配置，应用壳遵循构建配置。构建脚本仅从 YAML 提取名称，不将整份品牌配置或本地路径写入客户端。桌面构建使用 Web 已声明的 YAML 解析依赖，因此先安装 Web 依赖。构建进程只读取 shell 环境，不自动加载 `.env`。
