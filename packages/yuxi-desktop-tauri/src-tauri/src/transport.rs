use crate::{instances::Instance, AppState};
use serde::Serialize;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tauri::{http::{HeaderMap, Request, Response}, AppHandle, Manager, WebviewWindow};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use url::Url;

pub struct Stream {
    pub owner: String,
    pub cancel: CancellationToken,
    pub response: Mutex<Option<reqwest::Response>>,
}

#[derive(Serialize)]
pub struct StreamHead {
    status: u16,
    headers: Vec<(String, String)>,
}

/// 转发只允许当前固定实例下的 API 与公开对象路径。
pub fn target_url(origin: &str, path: &str) -> Result<Url, String> {
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') {
        return Err("请求路径无效".into());
    }
    let target = Url::parse(&format!("{origin}{path}")).map_err(|_| "请求路径无效")?;
    let base = Url::parse(origin).map_err(|_| "实例地址无效")?;
    if target.origin() != base.origin() || !is_forward_path(target.path()) || target.fragment().is_some() {
        return Err("只允许访问当前实例的 API 与公开资源".into());
    }
    Ok(target)
}

/// 与 Web 公共接口路径保持一致，不开放通用 HTTP 代理。
pub fn is_forward_path(path: &str) -> bool {
    path.starts_with("/api/") || path.starts_with("/minio/public/")
}

/// 去掉宿主 origin 与传输层头，认证头只发给已绑定的实例。
fn forward_headers(headers: &HeaderMap) -> HeaderMap {
    headers.iter().filter(|(name, _)| !matches!(name.as_str(),
        "host" | "connection" | "content-length" | "transfer-encoding" | "origin" | "referer" | "cookie"
    )).map(|(name, value)| (name.clone(), value.clone())).collect()
}

/// 连接与响应头阶段有界等待；收到头后由消费方控制响应体生命周期。
pub async fn send(
    client: &reqwest::Client,
    instance: &Instance,
    request: Request<Vec<u8>>,
    cancel: &CancellationToken,
) -> Result<reqwest::Response, String> {
    let path = request.uri().path_and_query().map(|value| value.as_str()).unwrap_or("/");
    let target = target_url(&instance.url, path)?;
    let request = client.request(request.method().clone(), target)
        .headers(forward_headers(request.headers())).body(request.into_body());
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err("请求已取消".into()),
        response = tokio::time::timeout(Duration::from_secs(10), request.send()) =>
            response.map_err(|_| "连接实例超时")?.map_err(|_| "无法连接实例，请检查网络与证书")?,
    };
    if response.status().is_redirection() {
        return Err("实例返回了重定向，请使用最终服务地址".into());
    }
    Ok(response)
}

impl Stream {
    /// 每次只读取一个网络块；取消优先于晚到的响应字节。
    pub async fn next(&self) -> Result<Option<Vec<u8>>, String> {
        let mut guard = self.response.lock().await;
        let response = guard.as_mut().ok_or("响应流尚未就绪")?;
        tokio::select! {
            biased;
            _ = self.cancel.cancelled() => Err("请求已取消".into()),
            chunk = response.chunk() => chunk.map(|value| value.map(|bytes| bytes.to_vec()))
                .map_err(|_| "读取实例响应失败，请重新连接".into()),
        }
    }
}

/// 普通请求保留方法、二进制 body 和响应头；事件流改由原生流命令读取。
pub async fn proxy(app: &AppHandle, label: &str, request: Request<Vec<u8>>) -> Result<Response<Vec<u8>>, String> {
    let state = app.state::<AppState>();
    let binding = state.binding(label)?;
    let instance = binding.instance.as_ref().ok_or("请先配置实例")?;
    let response = send(&binding.client, instance, request, &binding.cancel).await?;
    let status = response.status();
    let headers = response.headers().clone();
    let body = tokio::select! {
        biased;
        _ = binding.cancel.cancelled() => return Err("请求已取消".into()),
        body = tokio::time::timeout(Duration::from_secs(120), response.bytes()) =>
            body.map_err(|_| "读取文件超时，请重试")?.map_err(|_| "读取实例响应失败")?,
    };
    let mut output = Response::builder().status(status);
    for (name, value) in headers.iter() {
        if !matches!(name.as_str(), "connection" | "transfer-encoding" | "content-length" | "content-security-policy") {
            output = output.header(name, value);
        }
    }
    // 代理内容只能作为数据消费，不获得本地应用的脚本和 frame 权限。
    output.header("Content-Security-Policy", "sandbox; default-src 'none'")
        .header("X-Content-Type-Options", "nosniff")
        .body(body.to_vec()).map_err(|_| "响应格式无效".into())
}

/// 只有当前主窗口能打开自身实例的业务请求，body 由页面按标准格式编码。
#[tauri::command]
pub async fn stream_open(
    app: AppHandle, window: WebviewWindow, id: String, path: String, method: String,
    body: Option<Vec<u8>>, headers: HashMap<String, String>,
) -> Result<StreamHead, String> {
    let state = app.state::<AppState>();
    let binding = state.assert_main(&window)?;
    if uuid::Uuid::parse_str(&id).is_err() { return Err("请求 ID 无效".into()); }
    let instance = binding.instance.as_ref().ok_or("请先配置实例")?;
    target_url(&instance.url, &path)?;
    let method = method.to_ascii_uppercase();
    if !matches!(method.as_str(), "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS") {
        return Err("请求方法无效".into());
    }
    let mut request = Request::builder().method(method.as_str()).uri(path);
    for (name, value) in headers {
        if !matches!(name.to_ascii_lowercase().as_str(), "authorization" | "accept" | "last-event-id"
            | "content-type" | "range" | "if-none-match" | "if-modified-since") {
            return Err("请求头无效".into());
        }
        request = request.header(name, value);
    }
    let request = request.body(body.unwrap_or_default()).map_err(|_| "请求格式无效")?;
    let stream = Arc::new(Stream {
        owner: binding.label.clone(), cancel: binding.cancel.child_token(), response: Mutex::new(None),
    });
    {
        let mut streams = state.streams.lock().unwrap();
        if streams.contains_key(&id) { return Err("请求 ID 已存在".into()); }
        streams.insert(id.clone(), stream.clone());
    }
    match send(&binding.client, instance, request, &stream.cancel).await {
        Ok(response) => {
            let head = StreamHead {
                status: response.status().as_u16(),
                headers: response.headers().iter().filter_map(|(key, value)|
                    value.to_str().ok().map(|value| (key.to_string(), value.to_owned()))
                ).collect(),
            };
            if stream.cancel.is_cancelled() {
                state.streams.lock().unwrap().remove(&id);
                return Err("请求已取消".into());
            }
            *stream.response.lock().await = Some(response);
            Ok(head)
        }
        Err(error) => { state.streams.lock().unwrap().remove(&id); Err(error) }
    }
}

/// 拉取受到读取背压约束的下一块响应，结束和失败均释放原生响应。
#[tauri::command]
pub async fn stream_read(app: AppHandle, window: WebviewWindow, id: String) -> Result<Option<Vec<u8>>, String> {
    let state = app.state::<AppState>();
    state.assert_main(&window)?;
    let stream = state.streams.lock().unwrap().get(&id).cloned().ok_or("响应流已关闭")?;
    if stream.owner != window.label() { return Err("拒绝跨窗口读取响应".into()); }
    let result = stream.next().await;
    if !matches!(&result, Ok(Some(_))) { state.streams.lock().unwrap().remove(&id); }
    result
}

/// reader.cancel、AbortSignal 和窗口销毁均能终止同一原生网络请求。
#[tauri::command]
pub fn stream_cancel(app: AppHandle, window: WebviewWindow, id: String) -> Result<(), String> {
    let state = app.state::<AppState>();
    state.assert_main(&window)?;
    let mut streams = state.streams.lock().unwrap();
    if streams.get(&id).is_some_and(|stream| stream.owner != window.label()) {
        return Err("拒绝跨窗口取消响应".into());
    }
    if let Some(stream) = streams.remove(&id) { stream.cancel.cancel(); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

    #[test]
    fn proxy_cannot_escape_the_bound_origin_or_allowed_routes() {
        assert_eq!(target_url("https://a.example", "/api/runs?x=1").unwrap().as_str(), "https://a.example/api/runs?x=1");
        for path in ["https://b.example/api/x", "//b.example/api/x", "/api/../admin", "/api/%2e%2e/admin", "/admin", "/api/x#fragment", "/api/\\evil"] {
            assert!(target_url("https://a.example", path).is_err(), "{path}");
        }
    }

    #[tokio::test]
    async fn response_delivers_first_chunk_before_completion_and_cancel_stops_reads() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut input = Vec::new();
            while !input.ends_with(b"\r\n\r\n") {
                input.push(socket.read_u8().await.unwrap());
                assert!(input.len() < 8192);
            }
            assert!(String::from_utf8_lossy(&input).starts_with("GET /api/agent/runs/test/events"));
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nfirst\r\n").await.unwrap();
            std::future::pending::<()>().await;
        });
        let instance = Instance { id: "test".into(), name: "test".into(), url: format!("http://{address}") };
        let client = reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let cancel = CancellationToken::new();
        let response = send(&client, &instance, Request::get("/api/agent/runs/test/events").body(Vec::new()).unwrap(), &cancel).await.unwrap();
        let stream = Stream { owner: "test".into(), cancel: cancel.clone(), response: Mutex::new(Some(response)) };
        assert_eq!(tokio::time::timeout(Duration::from_secs(1), stream.next()).await.unwrap().unwrap(), Some(b"first".to_vec()));
        cancel.cancel();
        assert!(tokio::time::timeout(Duration::from_secs(1), stream.next()).await.unwrap().is_err());
        task.abort();
    }

    #[tokio::test]
    async fn upload_bytes_are_preserved_and_cookies_do_not_cross_instance_sessions() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            for index in 0..3 {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut input = Vec::new();
                while !input.ends_with(b"\r\n\r\n") {
                    input.push(socket.read_u8().await.unwrap());
                    assert!(input.len() < 8192);
                }
                let headers = String::from_utf8(input).unwrap().to_ascii_lowercase();
                assert_eq!(headers.contains("cookie: session=instance-a"), index == 1);
                if index == 0 {
                    assert!(headers.starts_with("post /api/upload "));
                    let mut body = [0; 3];
                    socket.read_exact(&mut body).await.unwrap();
                    assert_eq!(body, [0, 255, 123]);
                }
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\nSet-Cookie: session=instance-a; Path=/; HttpOnly\r\n\r\n\x00\xff{").await.unwrap();
            }
        });
        let instance = Instance { id: "a".into(), name: "A".into(), url: format!("http://{address}") };
        let original = crate::instance_client().unwrap();
        let fresh = crate::instance_client().unwrap();
        for (index, client) in [&original, &original, &fresh].into_iter().enumerate() {
            let request = if index == 0 {
                Request::post("/api/upload").header("content-type", "application/octet-stream").body(vec![0, 255, 123]).unwrap()
            } else {
                // 旧页面传来的 Cookie 也不能替代新实例自己的 Cookie jar。
                Request::get("/api/read").header("cookie", "session=instance-a").body(Vec::new()).unwrap()
            };
            let response = send(client, &instance, request, &CancellationToken::new()).await.unwrap();
            assert_eq!(response.bytes().await.unwrap().as_ref(), &[0, 255, 123]);
        }
        server.await.unwrap();
    }
}
