mod terminal;

use base64::Engine;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
}

#[tauri::command]
fn default_local_root() -> Result<String, String> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").map_err(|_| "USERPROFILE is not set".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").map_err(|_| "HOME is not set".to_string())
    }
}

#[tauri::command]
fn parent_directory(path: String) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }
    Path::new(trimmed).parent().map(|parent| parent.to_string_lossy().to_string())
}

#[tauri::command]
fn list_directory(path: String) -> Result<Vec<FsEntry>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }

    let dir = PathBuf::from(trimmed);
    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", trimmed));
    }

    let mut entries: Vec<FsEntry> = Vec::new();
    for item in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let meta = item.metadata().map_err(|e| e.to_string())?;
        entries.push(FsEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: item.path().to_string_lossy().into_owned(),
            is_directory: meta.is_dir(),
        });
    }

    entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a
            .name
            .to_lowercase()
            .cmp(&b.name.to_lowercase()),
    });

    Ok(entries)
}

fn image_mime(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

#[tauri::command]
fn read_image_data_url(path: String) -> Result<String, String> {
    let source = PathBuf::from(path.trim());
    if !source.is_file() {
        return Err("Not a file path".into());
    }

    let mime = image_mime(&source).ok_or_else(|| "Unsupported image format".to_string())?;
    let bytes = std::fs::read(&source).map_err(|e| e.to_string())?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{};base64,{}", mime, encoded))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(terminal::TerminalSession::default())
        .invoke_handler(tauri::generate_handler![
            default_local_root,
            parent_directory,
            list_directory,
            read_image_data_url,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
