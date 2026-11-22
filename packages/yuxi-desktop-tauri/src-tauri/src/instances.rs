use serde::{Deserialize, Serialize};
use std::{collections::HashSet, fs, io::Write, path::Path};
use url::Url;
use uuid::Uuid;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub url: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    pub instances: Vec<Instance>,
    pub current_id: Option<String>,
}

/// 只接收无路径、查询或凭据的 HTTP(S) 实例 origin。
pub fn normalize_url(input: &str) -> Result<String, String> {
    let value = input.trim();
    if value.is_empty() {
        return Err("实例地址不能为空".into());
    }
    let address = if value.contains("://") { value.to_owned() } else { format!("https://{value}") };
    let url = Url::parse(&address).map_err(|_| "实例地址格式无效")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none()
        || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path() != "/"
    {
        return Err("请填写不含账号、路径或查询参数的 HTTP(S) 实例地址".into());
    }
    Ok(url.origin().ascii_serialization())
}

impl Store {
    /// 配置损坏时保留原始文件；不可读取和不可备份时显式失败。
    pub fn load(path: &Path) -> Result<Self, String> {
        let bytes = match fs::read(path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Self::default()),
            Err(_) => return Err("无法读取实例配置".into()),
        };
        let parsed = serde_json::from_slice::<Self>(&bytes).ok().filter(|store| store.valid());
        if let Some(mut store) = parsed {
            if store.current().is_none() {
                store.current_id = store.instances.first().map(|instance| instance.id.clone());
            }
            return Ok(store);
        }
        let backup = path.with_extension(format!("corrupt-{}.json", Uuid::new_v4()));
        fs::copy(path, backup).map_err(|_| "实例配置已损坏且无法备份，请检查目录权限")?;
        Ok(Self::default())
    }

    /// 在同目录写入私有临时文件，再原子发布完整快照。
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let parent = path.parent().ok_or("实例配置目录无效")?;
        fs::create_dir_all(parent).map_err(|_| "无法创建实例配置目录")?;
        let temporary = parent.join(format!("instances-{}.tmp", Uuid::new_v4()));
        let result = (|| {
            let mut options = fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temporary)?;
            let bytes = serde_json::to_vec_pretty(self).map_err(std::io::Error::other)?;
            file.write_all(&bytes)?;
            file.write_all(b"\n")?;
            file.sync_all()?;
            fs::rename(&temporary, path)
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        result.map_err(|_: std::io::Error| "无法保存实例配置，请检查磁盘空间与目录权限".into())
    }

    /// 当前实例由持久 ID 选择。
    pub fn current(&self) -> Option<&Instance> {
        self.instances.iter().find(|instance| Some(&instance.id) == self.current_id.as_ref())
    }

    /// 校验持久化边界的 ID、名称、规范 URL 和唯一性。
    fn valid(&self) -> bool {
        let mut ids = HashSet::new();
        let mut urls = HashSet::new();
        self.instances.iter().all(|instance| {
            Uuid::parse_str(&instance.id).is_ok() && !instance.name.trim().is_empty()
                && instance.name.chars().count() <= 100
                && normalize_url(&instance.url).as_ref() == Ok(&instance.url)
                && ids.insert(&instance.id) && urls.insert(&instance.url)
        })
    }

    /// 新增或编辑时复用同一字段与重复地址校验。
    pub fn put(&mut self, id: Option<String>, name: String, input: String) -> Result<(), String> {
        let name = name.trim().to_owned();
        if name.is_empty() || name.chars().count() > 100 {
            return Err("实例名称需要 1–100 个字符".into());
        }
        let url = normalize_url(&input)?;
        if self.instances.iter().any(|item| Some(&item.id) != id.as_ref() && item.url == url) {
            return Err("该实例地址已经存在".into());
        }
        if let Some(id) = id {
            let entry = self.instances.iter_mut().find(|item| item.id == id).ok_or("实例不存在")?;
            *entry = Instance { id, name, url };
        } else {
            let id = Uuid::new_v4().to_string();
            if self.current_id.is_none() { self.current_id = Some(id.clone()); }
            self.instances.push(Instance { id, name, url });
        }
        Ok(())
    }

    /// 删除当前实例后选择剩余首项，删除未知 ID 显式失败。
    pub fn remove(&mut self, id: &str) -> Result<(), String> {
        let index = self.instances.iter().position(|item| item.id == id).ok_or("实例不存在")?;
        self.instances.remove(index);
        if self.current_id.as_deref() == Some(id) {
            self.current_id = self.instances.first().map(|item| item.id.clone());
        }
        Ok(())
    }

    /// 仅允许切换到已保存实例。
    pub fn switch(&mut self, id: &str) -> Result<(), String> {
        if !self.instances.iter().any(|item| item.id == id) { return Err("实例不存在".into()); }
        self.current_id = Some(id.into());
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn origin_validation_rejects_credentials_and_paths() {
        assert_eq!(normalize_url(" example.com/ ").unwrap(), "https://example.com");
        for value in ["", "file:///tmp", "https://user:pass@example.com", "https://example.com/api", "https://example.com/?x=1", "https://example.com/#x"] {
            assert!(normalize_url(value).is_err(), "{value}");
        }
    }

    #[test]
    fn edits_keep_ids_and_reject_duplicate_or_unknown_targets() {
        let mut store = Store::default();
        store.put(None, "A".into(), "https://a.example".into()).unwrap();
        let id = store.current_id.clone().unwrap();
        assert!(store.put(None, "duplicate".into(), "https://a.example".into()).is_err());
        assert!(store.switch("unknown").is_err());
        store.put(Some(id.clone()), "renamed".into(), "https://b.example".into()).unwrap();
        assert_eq!(store.current().unwrap().id, id);
        store.remove(&id).unwrap();
        assert!(store.current().is_none());
    }

    #[test]
    fn configuration_is_atomic_and_corrupt_bytes_are_preserved() {
        let directory = std::env::temp_dir().join(format!("yuxi-tauri-{}", Uuid::new_v4()));
        let path = directory.join("instances.json");
        let mut store = Store::default();
        store.put(None, "A".into(), "https://a.example".into()).unwrap();
        store.save(&path).unwrap();
        assert_eq!(Store::load(&path).unwrap().current(), store.current());
        fs::write(&path, b"null").unwrap();
        assert!(Store::load(&path).unwrap().instances.is_empty());
        assert!(fs::read_dir(&directory).unwrap().any(|entry| fs::read(entry.unwrap().path()).unwrap() == b"null"));
        assert!(store.save(&path.join("not-a-directory")).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
