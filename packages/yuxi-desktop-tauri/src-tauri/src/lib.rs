mod auth;
mod instances;
mod transport;

use instances::{Instance, Store};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{atomic::AtomicBool, Arc, Mutex}, time::Duration};
use tauri::{menu::{Menu, SubmenuBuilder}, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tokio_util::sync::CancellationToken;
use url::Url;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildInfo {
    desktop_version: String,
    web_version: String,
    product_name: String,
    runtime: String,
}

#[derive(Clone, Serialize)]
struct Connection {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

/// Cookie jar 只随一个实例窗口存活，不共享到检查连接或其他实例。
fn instance_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5)).cookie_store(true).build().map_err(|_| "无法创建实例网络会话".into())
}

#[derive(Clone)]
pub struct Binding {
    pub label: String,
    pub instance: Option<Instance>,
    pub cancel: CancellationToken,
    pub client: reqwest::Client,
}

pub struct AppState {
    store: Mutex<Store>,
    file: PathBuf,
    build: BuildInfo,
    status: Mutex<Connection>,
    main: Mutex<Option<Binding>>,
    changes: tokio::sync::Mutex<()>,
    pub client: reqwest::Client,
    pub streams: Mutex<HashMap<String, Arc<transport::Stream>>>,
    pub authorizing: AtomicBool,
}

impl AppState {
    /// 窗口与创建时实例绑定，过期窗口不能访问新目标。
    pub fn binding(&self, label: &str) -> Result<Binding, String> {
        self.main.lock().unwrap().as_ref().filter(|binding| binding.label == label)
            .cloned().ok_or_else(|| "拒绝来自过期或非主窗口的请求".into())
    }

    /// 原生副作用检查窗口身份和页面来源，代理文件不是受信页面。
    pub fn assert_main(&self, window: &WebviewWindow) -> Result<Binding, String> {
        let url = window.url().map_err(|_| "无法确认页面来源")?;
        if !trusted_page(window.label(), &url, false) { return Err("拒绝来自非可信页面的请求".into()); }
        self.binding(window.label())
    }

    /// 关闭和切换都释放网络资源，持久化配置不依赖窗口存活。
    fn release(&self, label: &str) {
        let mut main = self.main.lock().unwrap();
        if main.as_ref().is_some_and(|binding| binding.label == label) {
            if let Some(binding) = main.take() { binding.cancel.cancel(); }
        }
        self.streams.lock().unwrap().retain(|_, stream| {
            if stream.owner == label { stream.cancel.cancel(); false } else { true }
        });
    }
}

/// 本地来源不允许端口、凭据或同名远端 host。
fn is_app_url(url: &Url) -> bool {
    url.scheme() == "yuxi" && url.host_str() == Some("localhost") && url.port().is_none()
        && url.username().is_empty() && url.password().is_none()
}

/// 只允许本地主页面生成的 Blob 下载，远端导航不能写入文件。
fn is_download_source(url: &Url) -> bool {
    url.as_str().strip_prefix("blob:").and_then(|value| Url::parse(value).ok())
        .is_some_and(|inner| is_app_url(&inner) && inner.query().is_none() && inner.fragment().is_none()
            && uuid::Uuid::parse_str(inner.path().trim_start_matches('/')).is_ok())
}

/// 文件名由本地重建并加随机后缀，保留扩展名且避免路径和覆盖。
fn download_name(suggested: &Path) -> String {
    let stem: String = suggested.file_stem().and_then(|value| value.to_str()).unwrap_or("download")
        .chars().filter(|value| !value.is_control() && !matches!(*value, '/' | '\\' | ':')).take(40).collect();
    let extension = suggested.extension().and_then(|value| value.to_str())
        .filter(|value| value.len() <= 16 && value.bytes().all(|byte| byte.is_ascii_alphanumeric()));
    let stem = if stem.trim_matches(['.', ' ']).is_empty() { "download" } else { &stem };
    format!("{stem}-{}{}", uuid::Uuid::new_v4(), extension.map(|value| format!(".{value}")).unwrap_or_default())
}

/// 主窗口和设置窗口分别授权，API/对象文档不能成为原生调用入口。
fn trusted_page(label: &str, url: &Url, settings: bool) -> bool {
    if !is_app_url(url) { return false; }
    if settings {
        label == "settings" && url.path() == "/__desktop/settings" && url.query().is_none() && url.fragment().is_none()
    } else {
        label.starts_with("main-") && !transport::is_forward_path(url.path())
            && !matches!(url.path(), "/__desktop/settings" | "/__desktop/settings.html")
    }
}

/// 外链使用固定系统程序和独立参数，不经 shell 执行。
fn open_external(value: &str) -> Result<(), String> {
    let url = Url::parse(value).map_err(|_| "外链地址无效")?;
    if !matches!(url.scheme(), "https" | "http") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
    {
        return Err("仅允许打开无内嵌凭据的 HTTP(S) 网页".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("/usr/bin/open").arg(url.as_str()).spawn()
            .map_err(|_| "无法打开系统浏览器")?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("当前桌面版本只支持 macOS".into())
}

/// readiness 与界面版本必须同时满足才能进入业务页面。
async fn check_connection(state: &AppState, value: &str, cancel: &CancellationToken) -> Connection {
    let result = async {
        let origin = instances::normalize_url(value)?;
        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err("连接已取消".to_owned()),
            response = state.client.get(format!("{origin}/api/system/ready")).timeout(Duration::from_secs(5)).send() =>
                response.map_err(|_| "连接失败，请检查地址、网络与证书")?,
        };
        if !response.status().is_success() { return Err("实例尚未就绪，请检查服务端状态".into()); }
        let data: Value = response.json().await.map_err(|_| "实例返回了无效的连接状态")?;
        if data.get("status").and_then(Value::as_str) != Some("ready") {
            return Err("实例尚未就绪，请检查服务端状态".into());
        }
        let version = data.get("version").and_then(Value::as_str).ok_or("实例未提供版本信息")?;
        if version != state.build.web_version {
            return Err(format!("客户端界面版本 {} 与实例版本 {version} 不一致，请更新客户端或实例", state.build.web_version));
        }
        Ok(version.to_owned())
    }.await;
    match result {
        Ok(version) => Connection { ok: true, message: format!("连接正常 · 服务端 {version}"), version: Some(version) },
        Err(message) => Connection { ok: false, message, version: None },
    }
}

/// 只导航当前仍存活的实例窗口，晚到的检查不能改变新窗口。
async fn show_content(app: &AppHandle, binding: &Binding) -> Result<(), String> {
    let state = app.state::<AppState>();
    let result = if let Some(instance) = &binding.instance {
        check_connection(&state, &instance.url, &binding.cancel).await
    } else { Connection { ok: false, message: "请先添加一个实例".into(), version: None } };
    if binding.cancel.is_cancelled() || state.binding(&binding.label).is_err() { return Ok(()); }
    let path = if result.ok { "/" } else { "/__desktop/status" };
    *state.status.lock().unwrap() = result;
    if let Some(window) = app.get_webview_window(&binding.label) {
        window.navigate(Url::parse(&format!("yuxi://localhost{path}")).unwrap()).map_err(|_| "无法加载桌面页面")?;
    }
    Ok(())
}

/// 每个主窗口使用独立非持久 Session，销毁后不复用旧实例登录态。
async fn ensure_main(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let previous = state.main.lock().unwrap().clone();
    if let Some(binding) = previous {
        if let Some(window) = app.get_webview_window(&binding.label) {
            window.show().map_err(|_| "无法显示主窗口")?;
            let _ = window.unminimize();
            let _ = window.set_focus();
            return Ok(());
        }
        state.release(&binding.label);
    }
    let instance = state.store.lock().unwrap().current().cloned();
    let client = instance_client()?;
    let binding = Binding { label: format!("main-{}", uuid::Uuid::new_v4()), instance, cancel: CancellationToken::new(), client };
    *state.main.lock().unwrap() = Some(binding.clone());
    *state.status.lock().unwrap() = Connection { ok: false, message: "正在连接实例…".into(), version: None };
    let title = window_title(&state.build.product_name, binding.instance.as_ref());
    let builder = WebviewWindowBuilder::new(app, &binding.label,
        WebviewUrl::CustomProtocol(Url::parse("yuxi://localhost/__desktop/status").unwrap()))
        .title(title).inner_size(1280.0, 820.0).min_inner_size(720.0, 480.0).incognito(true)
        .on_navigation(|url| {
            if trusted_page("main-navigation", url, false) { return true; }
            // 无同源权限的 srcdoc 用于 HTML 附件；about 页面始终不通过命令来源检查。
            if url.as_str() == "about:srcdoc" || url.as_str() == "about:blank" { return true; }
            if matches!(url.scheme(), "http" | "https") { let _ = open_external(url.as_str()); }
            false
        })
        .on_new_window(|url, _| {
            let _ = open_external(url.as_str());
            tauri::webview::NewWindowResponse::Deny
        })
        .on_download(|window, event| {
            if window.state::<AppState>().binding(window.label()).is_err() { return false; }
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    if !is_download_source(&url) { return false; }
                    match window.path().download_dir() {
                        Ok(directory) if directory.is_dir() => {
                            *destination = directory.join(download_name(destination));
                            true
                        }
                        _ => { show_error(window.app_handle(), "无法访问系统下载目录，请检查目录与权限".into()); false }
                    }
                }
                tauri::webview::DownloadEvent::Finished { success, .. } => {
                    if !success { show_error(window.app_handle(), "下载失败，请检查网络和下载目录权限后重试".into()); }
                    true
                }
                _ => false,
            }
        });
    let window = match builder.build() {
        Ok(window) => window,
        Err(_) => { state.release(&binding.label); return Err("无法创建主窗口".into()); }
    };
    let owner = binding.label.clone();
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) { handle.state::<AppState>().release(&owner); }
    });
    show_content(app, &binding).await
}

/// 原生菜单、Dock 和第二进程共用同一个窗口创建队列。
async fn restore_main(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _change = state.changes.lock().await;
    ensure_main(&app).await
}

/// 设置窗口独立授权，不允许导航到业务或远端页面。
fn open_settings(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|_| "无法显示设置窗口")?;
        let _ = window.set_focus();
        return Ok(());
    }
    WebviewWindowBuilder::new(app, "settings", WebviewUrl::CustomProtocol(Url::parse("yuxi://localhost/__desktop/settings").unwrap()))
        .title(format!("{} 实例设置", app.state::<AppState>().build.product_name))
        .inner_size(680.0, 650.0).min_inner_size(520.0, 480.0).incognito(true)
        .on_navigation(|url| trusted_page("settings", url, true))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build().map_err(|_| "无法创建实例设置窗口")?;
    Ok(())
}

/// 取消请求后销毁非持久 WebView，新目标创建全新的 WebView 和 Cookie jar。
fn close_main(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let binding = state.main.lock().unwrap().clone();
    if let Some(binding) = binding {
        state.release(&binding.label);
        if let Some(window) = app.get_webview_window(&binding.label) {
            window.destroy().map_err(|_| "无法关闭旧实例窗口，请重新启动客户端")?;
        }
    }
    Ok(())
}

/// 窗口标题展示实例，帮助识别当前环境。
fn window_title(product: &str, instance: Option<&Instance>) -> String {
    instance.map(|instance| format!("{product} · {}", instance.name)).unwrap_or_else(|| product.to_owned())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MainAction { Current, Status, OpenSettings, OpenExternal { url: String }, Retry, AuthorizeOidc }

/// 主窗口命令不提供实例写入或任意系统调用能力。
#[tauri::command]
pub async fn desktop_main(app: AppHandle, window: WebviewWindow, operation: MainAction) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let binding = state.assert_main(&window)?;
    match operation {
        MainAction::Current => Ok(json!(binding.instance)),
        MainAction::Status => {
            let mut value = serde_json::to_value(&*state.status.lock().unwrap()).map_err(|_| "状态读取失败")?;
            value["instance"] = json!(binding.instance);
            value["build"] = json!(state.build);
            Ok(value)
        }
        MainAction::OpenSettings => { open_settings(&app)?; Ok(json!({"ok": true})) }
        MainAction::OpenExternal { url } => { open_external(&url)?; Ok(Value::Null) }
        MainAction::Retry => {
            let _change = state.changes.lock().await;
            state.assert_main(&window)?;
            show_content(&app, &binding).await?;
            Ok(Value::Null)
        }
        MainAction::AuthorizeOidc => auth::authorize(&app, &binding).await.map(|code| json!({"code": code})),
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SettingsAction {
    State,
    Add { name: String, url: String },
    Update { id: String, name: String, url: String },
    Remove { id: String },
    Switch { id: String },
    Check { url: String },
}

/// 设置操作串行持久化；落盘失败不会销毁当前窗口或清除会话。
#[tauri::command]
pub async fn desktop_settings(app: AppHandle, window: WebviewWindow, operation: SettingsAction) -> Result<Value, String> {
    if !trusted_page(window.label(), &window.url().map_err(|_| "无法确认设置来源")?, true) {
        return Err("拒绝来自非设置页面的实例操作".into());
    }
    let state = app.state::<AppState>();
    if matches!(operation, SettingsAction::State) {
        let store = state.store.lock().unwrap();
        return Ok(json!({"instances": store.instances, "currentId": store.current_id, "build": state.build}));
    }
    if let SettingsAction::Check { url } = operation {
        return Ok(json!(check_connection(&state, &url, &CancellationToken::new()).await));
    }
    let _change = state.changes.lock().await;
    let wants_main = matches!(&operation, SettingsAction::Switch { .. });
    let mut next = state.store.lock().unwrap().clone();
    let before = next.current().cloned();
    match operation {
        SettingsAction::Add { name, url } => next.put(None, name, url)?,
        SettingsAction::Update { id, name, url } => next.put(Some(id), name, url)?,
        SettingsAction::Remove { id } => next.remove(&id)?,
        SettingsAction::Switch { id } => next.switch(&id)?,
        _ => unreachable!(),
    }
    let after = next.current().cloned();
    let changed = before.as_ref().map(|instance| (&instance.id, &instance.url))
        != after.as_ref().map(|instance| (&instance.id, &instance.url));
    next.save(&state.file)?;
    *state.store.lock().unwrap() = next;
    let _ = app.emit_to("settings", "instances:changed", ());
    if changed {
        close_main(&app)?;
        ensure_main(&app).await?;
    } else {
        let binding = state.main.lock().unwrap().clone();
        if let Some(binding) = binding {
            if let Some(window) = app.get_webview_window(&binding.label) {
                let _ = window.set_title(&window_title(&state.build.product_name, after.as_ref()));
            }
            if let Some(current) = state.main.lock().unwrap().as_mut() { current.instance = after; }
        }
    }
    if !changed && wants_main { ensure_main(&app).await?; }
    Ok(json!({"ok": true}))
}

/// 自定义协议只服务本地已打包资源和该窗口绑定的实例。
async fn protocol(app: AppHandle, label: String, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::Response;
    let error = |status, message: &str| Response::builder().status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        .body(serde_json::to_vec(&json!({"detail": message})).unwrap()).unwrap();
    let url = match Url::parse(&request.uri().to_string()) {
        Ok(url) if is_app_url(&url) => url,
        _ => return error(403, "页面来源无效"),
    };
    if label != "settings" && app.state::<AppState>().binding(&label).is_err() {
        return error(403, "窗口已关闭");
    }
    if transport::is_forward_path(url.path()) {
        if label == "settings" { return error(403, "设置页不能代理业务请求"); }
        return transport::proxy(&app, &label, request).await.unwrap_or_else(|message| error(502, &message));
    }
    if !matches!(request.method().as_str(), "GET" | "HEAD") { return error(405, "请求方法无效"); }
    let path = match url.path() {
        "/__desktop/settings" => "__desktop/settings.html",
        "/__desktop/status" => "__desktop/status.html",
        path => path.trim_start_matches('/'),
    };
    let resolver = app.asset_resolver();
    let asset = resolver.get(if path.is_empty() { "index.html".to_owned() } else { path.to_owned() })
        .or_else(|| if !path.starts_with("__desktop/") && !path.starts_with("assets/") && !path.contains('.') {
            resolver.get("index.html".to_owned())
        } else { None });
    if let Some(asset) = asset {
        let mut response = Response::builder().header("Content-Type", asset.mime_type)
            .header("Cache-Control", "no-cache").header("X-Content-Type-Options", "nosniff");
        if let Some(csp) = asset.csp_header { response = response.header("Content-Security-Policy", csp); }
        response
            .body(if request.method() == "HEAD" { Vec::new() } else { asset.bytes }).unwrap()
    } else { error(404, "客户端资源不存在，请重新构建或安装") }
}

/// 原生入口失败提供可见错误，不能留下无窗口后台进程。
fn show_error(app: &AppHandle, message: String) {
    app.dialog().message(message).title("桌面客户端").show(|_| {});
}

/// 装配独立应用身份、受限命令、自定义协议与原生恢复入口。
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = restore_main(app.clone()).await { show_error(&app, error); }
            });
        }))
        .register_asynchronous_uri_scheme_protocol("yuxi", |context, request, responder| {
            let app = context.app_handle().clone();
            let label = context.webview_label().to_owned();
            tauri::async_runtime::spawn(async move { responder.respond(protocol(app, label, request).await); });
        })
        .invoke_handler(tauri::generate_handler![desktop_main, desktop_settings,
            transport::stream_open, transport::stream_read, transport::stream_cancel])
        .setup(|app| {
            let file = app.path().app_data_dir()?.join("instances.json");
            let state = AppState {
                store: Mutex::new(Store::load(&file).map_err(std::io::Error::other)?), file,
                build: serde_json::from_str(include_str!("../../renderer/desktop-build.json"))?,
                status: Mutex::new(Connection { ok: false, message: "正在启动…".into(), version: None }),
                main: Mutex::new(None), changes: tokio::sync::Mutex::new(()),
                client: reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).connect_timeout(Duration::from_secs(5)).build()?,
                streams: Mutex::new(HashMap::new()), authorizing: AtomicBool::new(false),
            };
            app.manage(state);
            let menu = Menu::default(app.handle())?;
            menu.append(&SubmenuBuilder::new(app.handle(), "实例")
                .text("open-main", "打开主窗口").text("open-settings", "实例设置…").build()?)?;
            app.set_menu(menu)?;
            app.on_menu_event(|app, event| {
                if event.id().as_ref() == "open-settings" {
                    if let Err(error) = open_settings(app) { show_error(app, error); }
                } else if event.id().as_ref() == "open-main" {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = restore_main(app.clone()).await { show_error(&app, error); }
                    });
                }
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = restore_main(handle.clone()).await { show_error(&handle, error); }
                let empty = handle.state::<AppState>().store.lock().unwrap().current().is_none();
                if empty { if let Err(error) = open_settings(&handle) { show_error(&handle, error); } }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 Tauri 桌面客户端")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::ExitRequested { code: None, api, .. } = &event {
                api.prevent_exit();
            }
            #[cfg(target_os = "macos")]
            if matches!(event, tauri::RunEvent::Reopen { .. }) {
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = restore_main(app.clone()).await { show_error(&app, error); }
                });
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_local_pages_of_the_expected_window_can_call_native_actions() {
        assert!(trusted_page("main-test", &Url::parse("yuxi://localhost/agent").unwrap(), false));
        assert!(trusted_page("settings", &Url::parse("yuxi://localhost/__desktop/settings").unwrap(), true));
        for value in ["https://localhost/agent", "about:srcdoc", "about:blank", "yuxi://evil/agent", "yuxi://user@localhost/agent", "yuxi://localhost/api/x", "yuxi://localhost/minio/public/x.svg", "yuxi://localhost/__desktop/settings"] {
            assert!(!trusted_page("main-test", &Url::parse(value).unwrap(), false), "{value}");
        }
        assert!(!trusted_page("oidc", &Url::parse("yuxi://localhost/agent").unwrap(), false));
        assert!(!trusted_page("main-test", &Url::parse("yuxi://localhost/__desktop/settings").unwrap(), true));
    }

    #[test]
    fn downloads_accept_only_local_blobs_and_generate_safe_distinct_names() {
        assert!(is_download_source(&Url::parse("blob:yuxi://localhost/00000000-0000-4000-8000-000000000000").unwrap()));
        for value in ["https://example.com/file", "blob:https://example.com/00000000-0000-4000-8000-000000000000", "yuxi://localhost/api/file", "blob:yuxi://localhost/not-a-uuid"] {
            assert!(!is_download_source(&Url::parse(value).unwrap()), "{value}");
        }
        let first = download_name(Path::new("../../report.pdf"));
        assert!(first.starts_with("report-"));
        assert!(first.ends_with(".pdf"));
        assert!(!first.contains('/'));
        assert_ne!(first, download_name(Path::new("report.pdf")));
        assert!(download_name(Path::new(&format!("{}.pdf", "测".repeat(200)))).len() < 255);
    }
}
