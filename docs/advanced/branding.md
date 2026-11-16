# 自定义品牌信息

部署者通过同一份品牌 YAML 设置 Web 与桌面端的产品展示名称、Logo 和协议链接；主题颜色通过前端样式调整。

## 统一产品名称

默认入口是 `backend/package/yuxi/config/static/info.template.yaml` 的 `branding.name`，默认名称由该字段定义。修改这个值即可统一首页、登录页、侧栏、浏览器标题、含品牌名的聊天欢迎语，以及桌面原生菜单、窗口、离线引导页和应用包名称：

```yaml
branding:
  name: "团队知识工作台"
```

默认组织名与版权使用 `{{PRODUCT_NAME}}` 引用这个值。组织名称和版权也可以填写独立文本；固定文本保留自己的值。已有本地配置如需跟随产品名，将相应名称改成 `{{PRODUCT_NAME}}`。

设置 `YUXI_BRAND_FILE_PATH` 时，API 与桌面构建选中该文件；未设置时选中默认本地文件 `backend/package/yuxi/config/static/info.local.yaml`。选中的文件不存在时直接使用模板，不合并 YAML。桌面构建的相对配置路径以 `backend/` 为基准，与 API 在该目录运行时一致。若本地文件已存在，直接修改它的 `branding.name`，模板中的同名字段不会覆盖本地配置。桌面构建只读取当前 shell 的环境变量，不自动加载 `.env`；使用自定义路径时，将该变量显式传给构建命令。

Web 页面刷新后从 `/api/system/info` 读取名称，无需重建前端。桌面中的业务页面同样读取当前实例配置；桌面原生菜单、离线页面与应用包名称使用构建时配置，修改后需在 `packages/yuxi-desktop` 执行 `npm run dist` 并退出旧进程，打开新应用。连接其他品牌实例时，业务页与客户端外壳可以有不同名称。

产品改名保留应用 ID、包名、协议、存储键和原有客户端数据目录，已有实例与登录数据继续使用原目录。GitHub 链接、开源项目署名、开发文档与 Agent 提示词中的项目介绍保持原有含义；图标和主题颜色有各自的配置入口。

## 配置站点信息

### 1. 创建本地配置

复制模板。`info.local.yaml` 通常是本地未跟踪文件；如果目标文件已经存在，不要覆盖它，直接编辑或先备份：

```bash
cp -n backend/package/yuxi/config/static/info.template.yaml \
  backend/package/yuxi/config/static/info.local.yaml
```

在 `info.local.yaml` 中修改：

```yaml
organization:
  name: "{{PRODUCT_NAME}}"
  logo: "/logo.svg"
  avatar: "/avatar.jpg"
  login_bg: "/login-bg.jpg"

branding:
  name: "Example App"
  title: "让团队知识更容易被使用"
  subtitle: "知识库与智能体工作台"

footer:
  copyright: "© {{PRODUCT_NAME}}"
  user_agreement_url: "/protocols/user-agreement.html"
  privacy_policy_url: "/protocols/privacy-policy.html"
```

图片和协议页面放在 `web/public` 下，路径从网站根目录开始写，例如 `/logo.svg`。Compose 中 API 的工作目录是 `/app`，因此默认配置路径可以写成：

```bash
YUXI_BRAND_FILE_PATH=package/yuxi/config/static/info.local.yaml
```

也可以在 `.env` 中设置绝对路径，但文件必须挂载到 API 容器中。路径不存在时，API 会回退到 `info.template.yaml`；它不会把两个 YAML 文件合并。YAML 解析失败或 `branding.name` 不是非空字符串时，信息接口返回错误，桌面构建失败。桌面构建在宿主机运行时，绝对路径必须指向宿主机可读文件。

### 2. 重新加载

开发环境的 API 直接挂载 `backend/package`，信息接口每次请求都读取 YAML。修改后刷新页面即可；修改 `YUXI_BRAND_FILE_PATH` 环境变量后需要重新创建 API 容器。

生产 Compose 不挂载仓库源码，品牌 YAML 会在构建 API 镜像时复制进去。修改 `backend/package/yuxi/config/static/info.local.yaml` 后，需要重新构建并创建 API/worker 容器：

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml \
  up -d --build --force-recreate api worker
```

如果使用仓库之外的品牌文件，需要在 Compose 覆盖配置中把它只读挂载到 API 容器，并让 `YUXI_BRAND_FILE_PATH` 指向容器内路径；修改该环境变量后同样要重新创建容器。页面会通过公开的 `/api/system/info` 读取站点信息，版本占位符 `{{YUXI_VERSION}}` 由 API 替换为当前版本。

## 登录协议

当 `footer.user_agreement_url` 和 `footer.privacy_policy_url` 同时有值时，登录和初始化页面显示协议勾选项；任一链接为空时，不显示勾选项。用户未勾选时，登录或初始化会被页面拦截并提示先同意协议。

仓库提供了两个模板：

- `web/public/protocols/user-agreement.template.html`
- `web/public/protocols/privacy-policy.template.html`

可以直接替换模板内容和其中的 `{{ORG_NAME}}`、`{{PRODUCT_NAME}}`、`{{EFFECTIVE_DATE}}` 等占位符，也可以把配置指向自定义的站内或外部页面。正式上线前请让法务审核协议文本。

## 修改主题样式

主题色变量位于：

- `web/src/assets/css/base.css`：浅色模式；
- `web/src/assets/css/base.dark.css`：暗色模式；
- `web/src/stores/theme.js`：主题选择器的默认配置。

优先修改已有 CSS 变量，不要在组件中散落新的硬编码颜色。当前主题的主要变量包括 `--main-1000`、`--main-900` 和 `--main-color`；如果调整主色，还要同步修改 `web/src/stores/theme.js` 中的 `colorPrimary`，否则 Ant Design 组件和自定义样式可能出现颜色不一致。新增颜色时，同时检查浅色、暗色、hover、focus、禁用和错误状态的对比度。

开发环境会通过 Vite 热更新样式；生产环境需要重新构建 Web 镜像：

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build web
```

品牌 YAML、主题颜色和图标属于不同配置面：YAML 影响站点信息接口，CSS 和 `theme.js` 影响前端资源。修改其中一项不会自动改动另一项。
