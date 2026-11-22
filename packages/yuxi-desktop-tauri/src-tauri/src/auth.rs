use crate::{AppState, Binding};
use serde::Deserialize;
use std::{sync::{atomic::Ordering, Arc, Mutex}, time::Duration};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::sync::oneshot;
use url::Url;

#[derive(Deserialize)]
struct LoginUrl { login_url: String }

/// 授权码只接受后端一次性码契约允许的可见 ASCII。
fn callback_code(url: &Url, origin: &str) -> Option<Result<String, String>> {
    if url.origin().ascii_serialization() != origin { return None; }
    if url.path() == "/login" && url.query_pairs().any(|(name, _)| name == "oidc_error") {
        return Some(Err("身份认证失败，请重试或联系管理员".into()));
    }
    if url.path() != "/auth/oidc/callback" { return None; }
    let code = url.query_pairs().find(|(name, _)| name == "code").map(|(_, value)| value.into_owned());
    Some(code.filter(|code| (16..=512).contains(&code.len()) && code.bytes().all(|byte| (0x21..=0x7e).contains(&byte)))
        .ok_or_else(|| "登录回调缺少有效授权码".into()))
}

/// 独立授权窗没有应用命令权限，切换实例或关闭窗口会终止等待。
pub async fn authorize(app: &AppHandle, binding: &Binding) -> Result<String, String> {
    let state = app.state::<AppState>();
    if state.authorizing.swap(true, Ordering::SeqCst) { return Err("已有登录窗口，请先完成或关闭".into()); }
    let result = authorize_inner(app, binding).await;
    state.authorizing.store(false, Ordering::SeqCst);
    result
}

/// 获取受信实例提供的登录地址，并只截获该实例的最终一次性码。
async fn authorize_inner(app: &AppHandle, binding: &Binding) -> Result<String, String> {
    let state = app.state::<AppState>();
    let instance = binding.instance.as_ref().ok_or("请先配置实例")?;
    let response = tokio::select! {
        biased;
        _ = binding.cancel.cancelled() => return Err("登录已取消".into()),
        response = binding.client.get(format!("{}/api/auth/oidc/login-url", instance.url))
            .timeout(Duration::from_secs(10)).send() => response.map_err(|_| "无法获取登录地址")?,
    };
    if !response.status().is_success() { return Err("无法获取登录地址，请检查实例 OIDC 配置".into()); }
    let data: LoginUrl = response.json().await.map_err(|_| "实例未提供有效登录地址")?;
    let login = Url::parse(&data.login_url).map_err(|_| "登录地址无效")?;
    if !matches!(login.scheme(), "https" | "http") || !login.username().is_empty() || login.password().is_some() {
        return Err("登录地址必须是无内嵌凭据的 HTTP(S) 网页".into());
    }
    if binding.cancel.is_cancelled() { return Err("登录已取消".into()); }
    let (sender, receiver) = oneshot::channel::<Result<String, String>>();
    let sender = Arc::new(Mutex::new(Some(sender)));
    let navigation_sender = sender.clone();
    let origin = instance.url.clone();
    let parent = app.get_webview_window(&binding.label).ok_or("主窗口已关闭")?;
    let label = format!("oidc-{}", uuid::Uuid::new_v4());
    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(login))
        .title(format!("{} 账户登录", state.build.product_name))
        .inner_size(560.0, 760.0).incognito(true)
        .parent(&parent).map_err(|_| "无法绑定授权窗口")?
        .on_navigation(move |url| {
            if let Some(result) = callback_code(url, &origin) {
                if let Some(sender) = navigation_sender.lock().unwrap().take() { let _ = sender.send(result); }
                return false;
            }
            matches!(url.scheme(), "https" | "http") && url.username().is_empty() && url.password().is_none()
        })
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build().map_err(|_| "无法创建登录窗口")?;
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            if let Some(sender) = sender.lock().unwrap().take() { let _ = sender.send(Err("登录已取消".into())); }
        }
    });
    let result = tokio::select! {
        biased;
        _ = binding.cancel.cancelled() => Err("登录已取消".into()),
        _ = tokio::time::sleep(Duration::from_secs(300)) => Err("登录超时，请重新发起登录".into()),
        result = receiver => result.unwrap_or_else(|_| Err("登录窗口已关闭".into())),
    };
    let _ = window.destroy();
    if let Some(parent) = app.get_webview_window(&binding.label) { let _ = parent.set_focus(); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callback_is_bound_to_instance_and_accepts_opaque_visible_codes() {
        let code = "opaque.=~+/0123456789";
        let mut url = Url::parse("https://a.example/auth/oidc/callback").unwrap();
        url.query_pairs_mut().append_pair("code", code);
        assert_eq!(callback_code(&url, "https://a.example").unwrap().unwrap(), code);
        assert!(callback_code(&url, "https://b.example").is_none());
        for value in ["short", "a control character\n", "非ASCII授权码必须拒绝"] {
            url.set_query(None);
            url.query_pairs_mut().append_pair("code", value);
            assert!(callback_code(&url, "https://a.example").unwrap().is_err());
        }
    }
}
