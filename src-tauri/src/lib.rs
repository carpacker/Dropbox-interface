mod dropbox;
mod terminal;

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

pub fn is_supported_image(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|s| s.to_ascii_lowercase())
            .as_deref(),
        Some("jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp")
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(terminal::TerminalSession::default())
        .manage(dropbox::DropboxState::new())
        .invoke_handler(tauri::generate_handler![
            default_local_root,
            parent_directory,
            list_directory,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            dropbox::commands::dropbox_status,
            dropbox::commands::dropbox_connect,
            dropbox::commands::dropbox_disconnect,
            dropbox::commands::dropbox_list_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn is_supported_image_accepts_known_extensions() {
        for ext in ["jpg", "jpeg", "png", "gif", "webp", "bmp"] {
            let p = PathBuf::from(format!("/x/y.{ext}"));
            assert!(is_supported_image(&p), "expected support for .{ext}");
        }
    }

    #[test]
    fn is_supported_image_is_case_insensitive() {
        assert!(is_supported_image(&PathBuf::from("/p/IMG.JPG")));
        assert!(is_supported_image(&PathBuf::from("/p/x.PnG")));
    }

    #[test]
    fn is_supported_image_rejects_other_formats() {
        assert!(!is_supported_image(&PathBuf::from("/p/x.tiff")));
        assert!(!is_supported_image(&PathBuf::from("/p/x.mp4")));
        assert!(!is_supported_image(&PathBuf::from("/p/x.txt")));
    }

    #[test]
    fn is_supported_image_rejects_extensionless() {
        assert!(!is_supported_image(&PathBuf::from("/p/README")));
        assert!(!is_supported_image(&PathBuf::from("")));
    }

    #[test]
    fn parent_directory_returns_parent_of_normal_path() {
        assert_eq!(
            parent_directory("/foo/bar".into()),
            Some("/foo".to_string())
        );
    }

    #[cfg(unix)]
    #[test]
    fn parent_directory_of_root_is_none() {
        assert_eq!(parent_directory("/".into()), None);
    }

    #[test]
    fn parent_directory_handles_empty_and_whitespace() {
        assert_eq!(parent_directory("".into()), None);
        assert_eq!(parent_directory("   ".into()), None);
    }

    #[test]
    fn parent_directory_trims_input() {
        assert_eq!(
            parent_directory("  /foo/bar  ".into()),
            Some("/foo".to_string())
        );
    }

    #[test]
    fn list_directory_rejects_empty_path() {
        let err = list_directory("".into()).unwrap_err();
        assert_eq!(err, "Path is empty");
    }

    #[test]
    fn list_directory_rejects_non_directory() {
        let dir = tempdir().unwrap();
        let file_path = dir.path().join("a.txt");
        fs::write(&file_path, b"hi").unwrap();
        let err = list_directory(file_path.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.starts_with("Not a directory"), "got: {err}");
    }

    #[test]
    fn list_directory_rejects_nonexistent_path() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let err = list_directory(missing.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.starts_with("Not a directory"), "got: {err}");
    }

    #[test]
    fn list_directory_returns_sorted_entries_dirs_first() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("zeta")).unwrap();
        fs::create_dir(dir.path().join("Alpha")).unwrap();
        fs::write(dir.path().join("readme.txt"), b"x").unwrap();
        fs::write(dir.path().join("BETA.png"), b"x").unwrap();

        let entries = list_directory(dir.path().to_string_lossy().into_owned()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["Alpha", "zeta", "BETA.png", "readme.txt"]);

        assert!(entries[0].is_directory);
        assert!(entries[1].is_directory);
        assert!(!entries[2].is_directory);
        assert!(!entries[3].is_directory);
    }

    #[test]
    fn list_directory_returns_empty_vec_for_empty_dir() {
        let dir = tempdir().unwrap();
        let entries = list_directory(dir.path().to_string_lossy().into_owned()).unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn list_directory_paths_are_absolute_strings() {
        let dir = tempdir().unwrap();
        fs::write(dir.path().join("a.png"), b"x").unwrap();
        let entries = list_directory(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].path.ends_with("a.png"));
        assert!(entries[0].path.contains(&*dir.path().to_string_lossy()));
    }
}
