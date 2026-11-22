fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "desktop_main", "desktop_settings", "stream_open", "stream_read", "stream_cancel",
        ]),
    )).expect("无法生成桌面权限与构建元数据");
}
