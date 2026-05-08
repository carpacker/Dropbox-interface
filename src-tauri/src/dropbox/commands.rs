use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::Mutex as AsyncMutex;

use super::api::{DropboxAccount, DropboxEntry};
use super::loopback::{accept_one, bind_loopback};
use super::oauth::{build_authorize_url, AuthorizeRequest, READ_ONLY_SCOPES};
use super::pkce;
use super::service::{DropboxService, ServiceError};
use super::tokens::KeyringStore;

/// Tauri-managed handle to the live `DropboxService`. The service itself is
/// constructed lazily from the user-supplied app key on the first
/// `dropbox_*` command, so the desktop bundle still launches when the key is
/// missing.
pub struct DropboxState {
    inner: AsyncMutex<Option<Arc<DropboxService>>>,
}

impl DropboxState {
    pub fn new() -> Self {
        Self {
            inner: AsyncMutex::new(None),
        }
    }

    async fn service(&self, app_key: &str) -> Arc<DropboxService> {
        let mut guard = self.inner.lock().await;
        if let Some(existing) = guard.as_ref() {
            if existing.app_key == app_key {
                return existing.clone();
            }
        }
        let svc = Arc::new(DropboxService::new(
            Arc::new(KeyringStore::default()),
            app_key.to_string(),
        ));
        *guard = Some(svc.clone());
        svc
    }
}

impl Default for DropboxState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn dropbox_status(
    state: State<'_, DropboxState>,
    app_key: String,
) -> Result<Option<DropboxAccount>, String> {
    if app_key.trim().is_empty() {
        return Ok(None);
    }
    let svc = state.service(&app_key).await;
    svc.status().await.map_err(ServiceError::into_string)
}

#[tauri::command]
pub async fn dropbox_disconnect(
    state: State<'_, DropboxState>,
    app_key: String,
) -> Result<(), String> {
    let svc = state.service(&app_key).await;
    svc.disconnect().await.map_err(ServiceError::into_string)
}

#[tauri::command]
pub async fn dropbox_list_folder(
    state: State<'_, DropboxState>,
    app_key: String,
    path: String,
) -> Result<Vec<DropboxEntry>, String> {
    let svc = state.service(&app_key).await;
    // Dropbox uses "" for the root, not "/".
    let normalized = if path == "/" { String::new() } else { path };
    svc.list_folder(&normalized)
        .await
        .map_err(ServiceError::into_string)
}

/// Fetch a thumbnail and return it as a `data:image/jpeg;base64,...` URL.
///
/// `size` is one of Dropbox's documented size tokens (e.g. `w128h128`,
/// `w256h256`, `w480h320`); see the Dropbox API docs.
#[tauri::command]
pub async fn dropbox_get_thumbnail(
    state: State<'_, DropboxState>,
    app_key: String,
    path: String,
    size: String,
) -> Result<String, String> {
    let svc = state.service(&app_key).await;
    let bytes = svc
        .get_thumbnail(&path, &size)
        .await
        .map_err(ServiceError::into_string)?;
    Ok(format!("data:image/jpeg;base64,{}", B64.encode(bytes)))
}

/// Stream a Dropbox file into a temporary local file and return its path.
///
/// Used by the frontend for inline preview: returning a local path lets the
/// renderer load the file via Tauri's asset protocol (`convertFileSrc`)
/// instead of base64-encoding multi-megabyte images into JS memory.
#[tauri::command]
pub async fn dropbox_download_to_temp(
    app: AppHandle,
    state: State<'_, DropboxState>,
    app_key: String,
    path: String,
) -> Result<String, String> {
    let svc = state.service(&app_key).await;

    let temp_root = app
        .path()
        .temp_dir()
        .map_err(|e| format!("could not resolve temp dir: {e}"))?
        .join("dropbox-interface")
        .join("preview");
    std::fs::create_dir_all(&temp_root)
        .map_err(|e| format!("create temp dir: {e}"))?;

    let dest = temp_root.join(safe_temp_filename(&path));
    svc.download_to_path(&path, &dest)
        .await
        .map_err(ServiceError::into_string)?;
    Ok(dest.to_string_lossy().into_owned())
}

/// Stream a Dropbox file directly to a user-chosen destination on disk.
#[tauri::command]
pub async fn dropbox_save_file_to(
    state: State<'_, DropboxState>,
    app_key: String,
    path: String,
    dest: String,
) -> Result<u64, String> {
    let svc = state.service(&app_key).await;
    let dest_path = PathBuf::from(dest);
    svc.download_to_path(&path, &dest_path)
        .await
        .map_err(ServiceError::into_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_temp_filename_is_deterministic() {
        let a = safe_temp_filename("/Photos/sunset.jpg");
        let b = safe_temp_filename("/Photos/sunset.jpg");
        assert_eq!(a, b);
    }

    #[test]
    fn safe_temp_filename_preserves_basename_with_hash_prefix() {
        let name = safe_temp_filename("/Photos/sunset.jpg");
        assert!(name.ends_with("-sunset.jpg"), "got {name}");
        // 8 hex chars + "-"
        assert_eq!(name.len(), 8 + 1 + "sunset.jpg".len());
    }

    #[test]
    fn safe_temp_filename_disambiguates_same_basename_in_different_folders() {
        let a = safe_temp_filename("/A/x.png");
        let b = safe_temp_filename("/B/x.png");
        assert_ne!(a, b);
        assert!(a.ends_with("-x.png"));
        assert!(b.ends_with("-x.png"));
    }

    #[test]
    fn safe_temp_filename_strips_path_separators_in_basename() {
        let name = safe_temp_filename("/x");
        // sanitize-filename leaves "x" as-is; no slashes should appear in
        // the returned name.
        assert!(!name.contains('/'));
    }

    #[test]
    fn safe_temp_filename_falls_back_to_hash_only_when_basename_is_empty() {
        let name = safe_temp_filename("/");
        assert_eq!(name.len(), 8); // hash prefix only
    }
}

/// Pick a stable, mostly-collision-free filename for a temp preview based on
/// the original Dropbox path. Uses sanitize-filename for cross-platform
/// safety; the leading hash disambiguates files that share a basename across
/// folders, and is deterministic so repeated previews of the same path land
/// in the same temp file.
pub(crate) fn safe_temp_filename(path: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(path.as_bytes());
    let digest = hasher.finalize();
    let prefix = format!(
        "{:02x}{:02x}{:02x}{:02x}",
        digest[0], digest[1], digest[2], digest[3]
    );

    let base = path.rsplit('/').next().unwrap_or("file");
    let cleaned = sanitize_filename::sanitize(base);
    if cleaned.is_empty() {
        return prefix;
    }
    format!("{prefix}-{cleaned}")
}

/// Run the full PKCE OAuth flow:
/// 1. bind a loopback listener
/// 2. open the authorize URL in the user's browser
/// 3. wait for the redirect, validate state, extract code
/// 4. exchange code for tokens, store them
/// 5. fetch and return the connected account
#[tauri::command]
pub async fn dropbox_connect(
    app: AppHandle,
    state: State<'_, DropboxState>,
    app_key: String,
) -> Result<DropboxAccount, String> {
    if app_key.trim().is_empty() {
        return Err("Missing Dropbox app key".into());
    }
    let svc = state.service(&app_key).await;

    // Step 1 — listener
    let (listener, port) = bind_loopback(53_682, 53_782)
        .map_err(|e| format!("could not bind loopback: {e}"))?;
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    // Step 2 — open browser
    let pkce_pair = pkce::generate();
    let state_token = pkce::state_token();
    let url = build_authorize_url(&AuthorizeRequest {
        app_key: &app_key,
        redirect_uri: &redirect_uri,
        code_challenge: &pkce_pair.challenge,
        state: &state_token,
        scopes: READ_ONLY_SCOPES,
    });

    let _ = app.opener().open_url(url.as_str(), None::<&str>);

    // Step 3 — wait for redirect on a background thread (the listener is
    // blocking std::net) and bridge into async.
    let captured = tokio::task::spawn_blocking(move || {
        accept_one(&listener, &state_token, Duration::from_secs(300))
    })
    .await
    .map_err(|e| format!("loopback task panicked: {e}"))?
    .map_err(|e| format!("oauth callback failed: {e}"))?;

    // Step 4 — exchange code for tokens
    let token_resp = svc
        .exchange_code(&captured.code, &pkce_pair.verifier, &redirect_uri)
        .await
        .map_err(ServiceError::into_string)?;
    svc.save_initial_tokens(token_resp)
        .map_err(ServiceError::into_string)?;

    // Step 5 — return account info
    let account = svc
        .status()
        .await
        .map_err(ServiceError::into_string)?
        .ok_or_else(|| "tokens stored but account lookup returned none".to_string())?;
    Ok(account)
}
