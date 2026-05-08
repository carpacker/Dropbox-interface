use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, State};
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
