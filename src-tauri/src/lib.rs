mod dropbox;
mod terminal;

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    /// File size in bytes; `None` for directories or when metadata is
    /// unavailable on the host platform.
    pub size: Option<u64>,
    /// Last-modified time as unix seconds; `None` when the platform's
    /// metadata layer can't surface it.
    pub modified: Option<i64>,
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
        let is_directory = meta.is_dir();
        let size = if is_directory { None } else { Some(meta.len()) };
        // Modified time → unix seconds. `Metadata::modified` can fail
        // on filesystems that don't track it (rare; we just surface
        // None so the UI can render a dash).
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64);
        entries.push(FsEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: item.path().to_string_lossy().into_owned(),
            is_directory,
            size,
            modified,
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

/// Default cap for `local_read_text_file`. Matches the Dropbox-side
/// `DEFAULT_TEXT_FILE_MAX_BYTES` so a pipeline config that round-trips
/// between local and Dropbox surfaces a consistent size limit.
const LOCAL_TEXT_FILE_MAX_BYTES: u64 = 256 * 1024;

/// Read a small text file (e.g. a `.dropbox-interface.json`) from local
/// disk. Returns `Some(contents)` on success, `None` when the file does
/// not exist, or an `Err` for any other failure. Bounded by `max_bytes`
/// (defaults to 256KB) so a hand-edited config file can't flood the
/// renderer.
#[tauri::command]
fn local_read_text_file(path: String, max_bytes: Option<u64>) -> Result<Option<String>, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }
    let cap = max_bytes.unwrap_or(LOCAL_TEXT_FILE_MAX_BYTES);
    let p = PathBuf::from(trimmed);

    let meta = match std::fs::metadata(&p) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if meta.is_dir() {
        return Err(format!("Not a file: {trimmed}"));
    }
    if meta.len() > cap {
        return Err(format!("file at {trimmed} exceeds {cap}-byte cap"));
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
    Ok(Some(text))
}

/// Move (or rename) a local file/folder. Used by pipeline Promote on
/// local-FS pipelines. The destination's parent must already exist.
#[tauri::command]
fn local_move(from_path: String, to_path: String) -> Result<FsEntry, String> {
    let from = from_path.trim();
    let to = to_path.trim();
    if from.is_empty() || to.is_empty() {
        return Err("Path is empty".into());
    }
    let from_p = PathBuf::from(from);
    let to_p = PathBuf::from(to);

    if !from_p.exists() {
        return Err(format!("Source does not exist: {from}"));
    }
    // Same-path no-op needs to be caught BEFORE the "destination exists"
    // check below — otherwise it would trip that and report a misleading
    // error.
    if from_p == to_p {
        return Err("Source and destination are the same".into());
    }
    if to_p.exists() {
        return Err(format!("Destination already exists: {to}"));
    }
    let to_parent = to_p
        .parent()
        .ok_or_else(|| format!("Destination has no parent: {to}"))?;
    if !to_parent.exists() {
        return Err(format!(
            "Destination parent does not exist: {}",
            to_parent.to_string_lossy()
        ));
    }

    std::fs::rename(&from_p, &to_p).map_err(|e| e.to_string())?;
    entry_for_path(&to_p)
}

/// Create a new directory at `path`. The parent must already exist;
/// fails if the path is already present (file or dir).
#[tauri::command]
fn local_create_folder(path: String) -> Result<FsEntry, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path is empty".into());
    }
    let p = PathBuf::from(trimmed);
    if p.exists() {
        return Err(format!("Path already exists: {trimmed}"));
    }
    let parent = p
        .parent()
        .ok_or_else(|| format!("Path has no parent: {trimmed}"))?;
    if !parent.exists() {
        return Err(format!(
            "Parent does not exist: {}",
            parent.to_string_lossy()
        ));
    }
    std::fs::create_dir(&p).map_err(|e| e.to_string())?;
    entry_for_path(&p)
}

/// Build an `FsEntry` describing an existing path. Used as the return
/// value for `local_move` / `local_create_folder` so callers can
/// optimistically update their listings without re-listing the parent.
fn entry_for_path(p: &Path) -> Result<FsEntry, String> {
    let meta = std::fs::metadata(p).map_err(|e| e.to_string())?;
    let is_directory = meta.is_dir();
    let size = if is_directory { None } else { Some(meta.len()) };
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(FsEntry {
        name,
        path: p.to_string_lossy().into_owned(),
        is_directory,
        size,
        modified,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(terminal::TerminalSession::default())
        .manage(dropbox::DropboxState::new())
        .invoke_handler(tauri::generate_handler![
            default_local_root,
            parent_directory,
            list_directory,
            local_read_text_file,
            local_move,
            local_create_folder,
            terminal::terminal_spawn,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            dropbox::commands::dropbox_status,
            dropbox::commands::dropbox_connect,
            dropbox::commands::dropbox_disconnect,
            dropbox::commands::dropbox_list_folder,
            dropbox::commands::dropbox_get_thumbnail,
            dropbox::commands::dropbox_download_to_temp,
            dropbox::commands::dropbox_save_file_to,
            dropbox::commands::dropbox_read_text_file,
            dropbox::commands::dropbox_move_v2,
            dropbox::commands::dropbox_create_folder_v2,
            dropbox::commands::dropbox_delete_v2,
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

    #[test]
    fn list_directory_populates_size_and_modified_for_files() {
        let dir = tempdir().unwrap();
        // Write 7 bytes; the size field should reflect that.
        fs::write(dir.path().join("a.bin"), b"1234567").unwrap();
        let entries = list_directory(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].size, Some(7));
        // Modified should be a recent unix-seconds value (within the
        // last day, generously). On exotic filesystems that don't
        // surface mtime, this can be None — accept either.
        if let Some(secs) = entries[0].modified {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            assert!(
                (secs - now).abs() < 24 * 60 * 60,
                "modified {} should be near now {}",
                secs,
                now,
            );
        }
    }

    #[test]
    fn list_directory_size_is_none_for_directories() {
        let dir = tempdir().unwrap();
        fs::create_dir(dir.path().join("sub")).unwrap();
        let entries = list_directory(dir.path().to_string_lossy().into_owned()).unwrap();
        assert_eq!(entries.len(), 1);
        assert!(entries[0].is_directory);
        assert_eq!(entries[0].size, None);
    }

    // -------- local_read_text_file ----------------------------------

    #[test]
    fn local_read_text_file_returns_contents() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("cfg.json");
        fs::write(&p, b"{\"hi\":1}").unwrap();
        let got =
            local_read_text_file(p.to_string_lossy().into_owned(), None).unwrap();
        assert_eq!(got.as_deref(), Some("{\"hi\":1}"));
    }

    #[test]
    fn local_read_text_file_missing_returns_none() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("nope.json");
        let got =
            local_read_text_file(p.to_string_lossy().into_owned(), None).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn local_read_text_file_rejects_empty_path() {
        let err = local_read_text_file("".into(), None).unwrap_err();
        assert_eq!(err, "Path is empty");
    }

    #[test]
    fn local_read_text_file_rejects_directory() {
        let dir = tempdir().unwrap();
        let err = local_read_text_file(dir.path().to_string_lossy().into_owned(), None)
            .unwrap_err();
        assert!(err.starts_with("Not a file"), "got: {err}");
    }

    #[test]
    fn local_read_text_file_enforces_byte_cap() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("big.json");
        // 100 bytes; cap at 50.
        fs::write(&p, vec![b'a'; 100]).unwrap();
        let err = local_read_text_file(p.to_string_lossy().into_owned(), Some(50))
            .unwrap_err();
        assert!(err.contains("exceeds"), "got: {err}");
    }

    #[test]
    fn local_read_text_file_rejects_non_utf8() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("binary.bin");
        // Invalid UTF-8 byte sequence.
        fs::write(&p, [0xff_u8, 0xfe, 0xfd]).unwrap();
        let err =
            local_read_text_file(p.to_string_lossy().into_owned(), None).unwrap_err();
        assert!(!err.is_empty());
    }

    // -------- local_move ---------------------------------------------

    #[test]
    fn local_move_renames_a_file_and_returns_entry() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("sub").join("a.txt");
        fs::create_dir(dir.path().join("sub")).unwrap();
        fs::write(&from, b"hello").unwrap();

        let entry = local_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert_eq!(entry.name, "a.txt");
        assert!(!entry.is_directory);
        assert_eq!(entry.size, Some(5));
        assert!(!from.exists());
        assert!(to.exists());
    }

    #[test]
    fn local_move_moves_a_directory() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("source");
        let to = dir.path().join("dest");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("inside.txt"), b"x").unwrap();

        let entry = local_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap();
        assert!(entry.is_directory);
        assert!(to.join("inside.txt").exists());
    }

    #[test]
    fn local_move_rejects_empty_paths() {
        assert_eq!(
            local_move("".into(), "/x".into()).unwrap_err(),
            "Path is empty",
        );
        assert_eq!(
            local_move("/x".into(), "".into()).unwrap_err(),
            "Path is empty",
        );
    }

    #[test]
    fn local_move_rejects_missing_source() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("nope");
        let to = dir.path().join("dest");
        let err = local_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(err.contains("Source does not exist"), "got: {err}");
    }

    #[test]
    fn local_move_rejects_existing_destination() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("b.txt");
        fs::write(&from, b"a").unwrap();
        fs::write(&to, b"b").unwrap();
        let err = local_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
        // Original file untouched.
        assert_eq!(fs::read(&from).unwrap(), b"a");
    }

    #[test]
    fn local_move_rejects_same_path() {
        let dir = tempdir().unwrap();
        let p = dir.path().join("a.txt");
        fs::write(&p, b"a").unwrap();
        let err = local_move(
            p.to_string_lossy().into_owned(),
            p.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(err.contains("same"), "got: {err}");
    }

    #[test]
    fn local_move_rejects_missing_destination_parent() {
        let dir = tempdir().unwrap();
        let from = dir.path().join("a.txt");
        let to = dir.path().join("nonexistent-parent").join("a.txt");
        fs::write(&from, b"a").unwrap();
        let err = local_move(
            from.to_string_lossy().into_owned(),
            to.to_string_lossy().into_owned(),
        )
        .unwrap_err();
        assert!(err.contains("parent does not exist"), "got: {err}");
        // Source untouched.
        assert!(from.exists());
    }

    // -------- local_create_folder ------------------------------------

    #[test]
    fn local_create_folder_creates_a_directory_and_returns_entry() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("1__Processing");
        let entry = local_create_folder(target.to_string_lossy().into_owned()).unwrap();
        assert!(target.exists());
        assert!(entry.is_directory);
        assert_eq!(entry.name, "1__Processing");
        assert_eq!(entry.size, None);
    }

    #[test]
    fn local_create_folder_rejects_empty_path() {
        let err = local_create_folder("".into()).unwrap_err();
        assert_eq!(err, "Path is empty");
    }

    #[test]
    fn local_create_folder_rejects_existing_path() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("already");
        fs::create_dir(&target).unwrap();
        let err = local_create_folder(target.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("already exists"), "got: {err}");
    }

    #[test]
    fn local_create_folder_rejects_missing_parent() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("nope").join("child");
        let err = local_create_folder(target.to_string_lossy().into_owned()).unwrap_err();
        assert!(err.contains("Parent does not exist"), "got: {err}");
    }
}
