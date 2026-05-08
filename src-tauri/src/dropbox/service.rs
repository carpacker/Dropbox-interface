use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde_json::json;

use super::api::{
    entries_from_raw, entry_from_raw, AccountResponse, DropboxAccount, DropboxEntry,
    ListFolderResponse, MetadataEnvelope,
};
use super::oauth::{TokenResponse, REVOKE_URL, TOKEN_URL};
use super::tokens::{StoredTokens, TokenStore, TokenStoreError};

/// All errors surfaced by the service. `String` payloads are designed to be
/// safe to bubble through `tauri::command` (which wants `Result<T, String>`).
#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("not connected to Dropbox")]
    NotConnected,
    #[error("network error: {0}")]
    Network(String),
    #[error("dropbox returned an error: {status} {body}")]
    Api { status: u16, body: String },
    #[error("token storage: {0}")]
    Storage(#[from] TokenStoreError),
    #[error("decode: {0}")]
    Decode(String),
}

impl ServiceError {
    pub fn into_string(self) -> String {
        self.to_string()
    }
}

/// Indirection over `SystemTime::now()` so tests can fix the clock.
pub trait Clock: Send + Sync + 'static {
    fn now_secs(&self) -> i64;
}

pub struct SystemClock;
impl Clock for SystemClock {
    fn now_secs(&self) -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }
}

/// Indirection over the OAuth/Files API endpoints so tests can swap in a
/// `wiremock` server. `api_base` covers RPC endpoints (api.dropboxapi.com/2),
/// `content_base` covers content endpoints (content.dropboxapi.com/2).
#[derive(Clone)]
pub struct ApiEndpoints {
    pub token_url: String,
    pub revoke_url: String,
    pub api_base: String,
    pub content_base: String,
}

impl Default for ApiEndpoints {
    fn default() -> Self {
        Self {
            token_url: TOKEN_URL.to_string(),
            revoke_url: REVOKE_URL.to_string(),
            api_base: "https://api.dropboxapi.com/2".to_string(),
            content_base: "https://content.dropboxapi.com/2".to_string(),
        }
    }
}

pub struct DropboxService {
    pub(crate) http: Client,
    pub(crate) store: Arc<dyn TokenStore>,
    pub(crate) clock: Arc<dyn Clock>,
    pub(crate) endpoints: ApiEndpoints,
    pub(crate) app_key: String,
}

impl DropboxService {
    pub fn new(store: Arc<dyn TokenStore>, app_key: impl Into<String>) -> Self {
        Self {
            http: Self::build_http_client(),
            store,
            clock: Arc::new(SystemClock),
            endpoints: ApiEndpoints::default(),
            app_key: app_key.into(),
        }
    }

    /// HTTP client with explicit, conservative timeouts so a hung Dropbox
    /// connection can't lock up a worker indefinitely.
    fn build_http_client() -> Client {
        Client::builder()
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(120))
            .pool_idle_timeout(Duration::from_secs(60))
            .build()
            .expect("static reqwest client config is valid")
    }

    /// Replace pieces of the service for tests.
    #[cfg(test)]
    pub fn with_test_doubles(
        store: Arc<dyn TokenStore>,
        clock: Arc<dyn Clock>,
        endpoints: ApiEndpoints,
        app_key: impl Into<String>,
    ) -> Self {
        Self {
            http: Self::build_http_client(),
            store,
            clock,
            endpoints,
            app_key: app_key.into(),
        }
    }

    pub async fn status(&self) -> Result<Option<DropboxAccount>, ServiceError> {
        let tokens = match self.store.load()? {
            Some(t) => t,
            None => return Ok(None),
        };
        let access = self.access_token_refreshing_if_needed(tokens).await?;
        let account = self.fetch_account(&access).await?;
        Ok(Some(account))
    }

    pub async fn list_folder(&self, path: &str) -> Result<Vec<DropboxEntry>, ServiceError> {
        let access = self.fresh_access_token().await?;
        let url = format!("{}/files/list_folder", self.endpoints.api_base);
        let body = json!({ "path": path, "recursive": false, "include_deleted": false });
        let resp = self
            .http
            .post(url)
            .bearer_auth(&access)
            .json(&body)
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body: text,
            });
        }
        let parsed: ListFolderResponse = serde_json::from_str(&text)
            .map_err(|e| ServiceError::Decode(e.to_string()))?;
        Ok(entries_from_raw(parsed.entries))
    }

    /// Read a small text file from Dropbox into memory, capped to
    /// `max_bytes`. Streams the response and bails as soon as the cap is
    /// crossed so a malicious or accidental large file can't blow out
    /// memory.
    ///
    /// Returns `Ok(None)` when the file is reported as `path/not_found` by
    /// the API; any other API failure (malformed path, permissions, etc.)
    /// returns `Err(ServiceError::Api)`.
    pub async fn read_text_capped(
        &self,
        path: &str,
        max_bytes: u64,
    ) -> Result<Option<String>, ServiceError> {
        let access = self.fresh_access_token().await?;
        let url = format!("{}/files/download", self.endpoints.content_base);
        let arg = json!({ "path": path });
        let mut resp = self
            .http
            .post(url)
            .bearer_auth(&access)
            .header("Dropbox-API-Arg", serde_json::to_string(&arg).unwrap())
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp
                .text()
                .await
                .unwrap_or_else(|e| format!("<read body: {e}>"));
            // Dropbox surfaces missing-path errors as 409 with a JSON body
            // containing `path/not_found`. Treat that as "no config" so
            // PipelineSource can fall back gracefully.
            if status == reqwest::StatusCode::CONFLICT && body.contains("not_found")
            {
                return Ok(None);
            }
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body,
            });
        }
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?
        {
            if (buf.len() as u64) + (chunk.len() as u64) > max_bytes {
                return Err(ServiceError::Decode(format!(
                    "file at {path} exceeds {max_bytes}-byte cap"
                )));
            }
            buf.extend_from_slice(&chunk);
        }
        String::from_utf8(buf)
            .map(Some)
            .map_err(|e| ServiceError::Decode(e.to_string()))
    }

    /// Stream a file from `/2/files/download` directly into the given local
    /// file path. Returns the number of bytes written.
    pub async fn download_to_path(
        &self,
        path: &str,
        dest: &std::path::Path,
    ) -> Result<u64, ServiceError> {
        use tokio::io::AsyncWriteExt;
        let mut resp = self.content_get(path, "/files/download").await?;
        let mut file = tokio::fs::File::create(dest)
            .await
            .map_err(|e| ServiceError::Network(format!("create {}: {e}", dest.display())))?;
        let mut total: u64 = 0;
        while let Some(chunk) = resp
            .chunk()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| ServiceError::Network(format!("write: {e}")))?;
            total += chunk.len() as u64;
        }
        file.flush()
            .await
            .map_err(|e| ServiceError::Network(format!("flush: {e}")))?;
        Ok(total)
    }

    /// Fetch a thumbnail via `/2/files/get_thumbnail_v2`. Returns the raw
    /// JPEG bytes. `size_token` is one of Dropbox's documented size strings:
    /// `w64h64`, `w128h128`, `w256h256`, `w480h320`, `w640h480`, `w960h640`,
    /// `w1024h768`, `w2048h1536`.
    pub async fn get_thumbnail(
        &self,
        path: &str,
        size_token: &str,
    ) -> Result<Vec<u8>, ServiceError> {
        let access = self.fresh_access_token().await?;
        let url = format!("{}/files/get_thumbnail_v2", self.endpoints.content_base);
        let arg = json!({
            "resource": {".tag": "path", "path": path},
            "format": "jpeg",
            "size": size_token,
            "mode": "fitone_bestfit",
        });
        let resp = self
            .http
            .post(url)
            .bearer_auth(&access)
            .header("Dropbox-API-Arg", serde_json::to_string(&arg).unwrap())
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp
                .text()
                .await
                .unwrap_or_else(|e| format!("<read body: {e}>"));
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body,
            });
        }
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        Ok(bytes.to_vec())
    }

    /// Shared helper for content-endpoint GET-style downloads. Dropbox's
    /// content API takes its parameters in the `Dropbox-API-Arg` header
    /// (JSON-encoded) rather than the body; the body must be empty.
    async fn content_get(
        &self,
        path: &str,
        endpoint: &'static str,
    ) -> Result<reqwest::Response, ServiceError> {
        let access = self.fresh_access_token().await?;
        let url = format!("{}{endpoint}", self.endpoints.content_base);
        let arg = json!({ "path": path });
        let resp = self
            .http
            .post(url)
            .bearer_auth(&access)
            .header("Dropbox-API-Arg", serde_json::to_string(&arg).unwrap())
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp
                .text()
                .await
                .unwrap_or_else(|e| format!("<read body: {e}>"));
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body,
            });
        }
        Ok(resp)
    }

    /// Convenience: load tokens, refresh if stale, return the access token.
    async fn fresh_access_token(&self) -> Result<String, ServiceError> {
        let tokens = self.store.load()?.ok_or(ServiceError::NotConnected)?;
        self.access_token_refreshing_if_needed(tokens).await
    }

    /// Move (or rename) an item via `/files/move_v2`. Returns the entry's
    /// new metadata. Used by the Promote action to shift an item from one
    /// state folder to its successor.
    pub async fn move_path(
        &self,
        from_path: &str,
        to_path: &str,
    ) -> Result<DropboxEntry, ServiceError> {
        let envelope: MetadataEnvelope = self
            .rpc(
                "/files/move_v2",
                json!({
                    "from_path": from_path,
                    "to_path": to_path,
                    "allow_shared_folder": false,
                    "autorename": false,
                    "allow_ownership_transfer": false,
                }),
            )
            .await?;
        entry_from_raw(envelope.metadata).ok_or_else(|| {
            ServiceError::Decode(
                "move_v2 returned metadata with an unexpected .tag".into(),
            )
        })
    }

    /// Create a folder via `/files/create_folder_v2`. Returns the new
    /// folder's metadata. Used by the "create missing state folder"
    /// affordance.
    pub async fn create_folder(&self, path: &str) -> Result<DropboxEntry, ServiceError> {
        let envelope: MetadataEnvelope = self
            .rpc(
                "/files/create_folder_v2",
                json!({ "path": path, "autorename": false }),
            )
            .await?;
        entry_from_raw(envelope.metadata).ok_or_else(|| {
            ServiceError::Decode(
                "create_folder_v2 returned metadata with an unexpected .tag".into(),
            )
        })
    }

    /// Shared helper for JSON-in/JSON-out RPC endpoints under
    /// `api.dropboxapi.com/2/...`. Refreshes the access token if needed,
    /// posts the JSON body, and decodes the response.
    async fn rpc<T: serde::de::DeserializeOwned>(
        &self,
        endpoint: &'static str,
        body: serde_json::Value,
    ) -> Result<T, ServiceError> {
        let access = self.fresh_access_token().await?;
        let url = format!("{}{endpoint}", self.endpoints.api_base);
        let resp = self
            .http
            .post(url)
            .bearer_auth(&access)
            .json(&body)
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| ServiceError::Decode(e.to_string()))
    }

    pub async fn disconnect(&self) -> Result<(), ServiceError> {
        if let Some(tokens) = self.store.load()? {
            // Best-effort: try to revoke server-side, but always clear local
            // state even if the network call fails.
            let _ = self
                .http
                .post(&self.endpoints.revoke_url)
                .bearer_auth(&tokens.access_token)
                .send()
                .await;
        }
        self.store.clear()?;
        Ok(())
    }

    /// Save a freshly-exchanged token bundle to the store.
    pub fn save_initial_tokens(
        &self,
        token_resp: TokenResponse,
    ) -> Result<StoredTokens, ServiceError> {
        let now = self.clock.now_secs();
        let stored = StoredTokens {
            access_token: token_resp.access_token,
            refresh_token: token_resp
                .refresh_token
                .ok_or_else(|| ServiceError::Decode(
                    "token response missing refresh_token; ensure token_access_type=offline".into(),
                ))?,
            expires_at: now + token_resp.expires_in as i64,
            account_id: token_resp.account_id.unwrap_or_default(),
        };
        self.store.save(&stored)?;
        Ok(stored)
    }

    /// Exchange an authorization code + verifier for tokens at the Dropbox
    /// token endpoint.
    pub async fn exchange_code(
        &self,
        code: &str,
        code_verifier: &str,
        redirect_uri: &str,
    ) -> Result<TokenResponse, ServiceError> {
        let form = [
            ("code", code),
            ("grant_type", "authorization_code"),
            ("client_id", self.app_key.as_str()),
            ("redirect_uri", redirect_uri),
            ("code_verifier", code_verifier),
        ];
        let resp = self
            .http
            .post(&self.endpoints.token_url)
            .form(&form)
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| ServiceError::Decode(e.to_string()))
    }

    async fn access_token_refreshing_if_needed(
        &self,
        tokens: StoredTokens,
    ) -> Result<String, ServiceError> {
        if !tokens.is_expired(self.clock.now_secs()) {
            return Ok(tokens.access_token);
        }
        let refreshed = self.refresh(&tokens.refresh_token).await?;
        let now = self.clock.now_secs();
        let updated = StoredTokens {
            access_token: refreshed.access_token.clone(),
            // Refresh response may omit refresh_token; keep the previous.
            refresh_token: refreshed
                .refresh_token
                .unwrap_or(tokens.refresh_token),
            expires_at: now + refreshed.expires_in as i64,
            account_id: refreshed.account_id.unwrap_or(tokens.account_id),
        };
        self.store.save(&updated)?;
        Ok(updated.access_token)
    }

    async fn refresh(&self, refresh_token: &str) -> Result<TokenResponse, ServiceError> {
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", self.app_key.as_str()),
        ];
        let resp = self
            .http
            .post(&self.endpoints.token_url)
            .form(&form)
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body: text,
            });
        }
        serde_json::from_str(&text).map_err(|e| ServiceError::Decode(e.to_string()))
    }

    async fn fetch_account(&self, access_token: &str) -> Result<DropboxAccount, ServiceError> {
        let url = format!("{}/users/get_current_account", self.endpoints.api_base);
        let resp = self
            .http
            .post(url)
            .bearer_auth(access_token)
            // Dropbox requires either no body or a JSON body for this RPC.
            .header("Content-Type", "application/json")
            .body("null")
            .send()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        let status = resp.status();
        let text = resp
            .text()
            .await
            .map_err(|e| ServiceError::Network(e.to_string()))?;
        if !status.is_success() {
            return Err(ServiceError::Api {
                status: status.as_u16(),
                body: text,
            });
        }
        let parsed: AccountResponse = serde_json::from_str(&text)
            .map_err(|e| ServiceError::Decode(e.to_string()))?;
        Ok(parsed.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dropbox::tokens::InMemoryStore;
    use std::sync::atomic::{AtomicI64, Ordering};
    use wiremock::matchers::{body_string_contains, header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct FixedClock(AtomicI64);
    impl FixedClock {
        fn new(secs: i64) -> Self {
            Self(AtomicI64::new(secs))
        }
        fn set(&self, secs: i64) {
            self.0.store(secs, Ordering::SeqCst);
        }
    }
    impl Clock for FixedClock {
        fn now_secs(&self) -> i64 {
            self.0.load(Ordering::SeqCst)
        }
    }

    async fn build_service(
        server: &MockServer,
        store: Arc<dyn TokenStore>,
        clock: Arc<FixedClock>,
    ) -> DropboxService {
        let endpoints = ApiEndpoints {
            token_url: format!("{}/oauth2/token", server.uri()),
            revoke_url: format!("{}/2/auth/token/revoke", server.uri()),
            api_base: format!("{}/2", server.uri()),
            content_base: format!("{}/2", server.uri()),
        };
        DropboxService::with_test_doubles(store, clock, endpoints, "test-key")
    }

    fn fresh_store() -> Arc<InMemoryStore> {
        Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at: 9_000,
            account_id: "dbid:1".into(),
        }))
    }

    #[tokio::test]
    async fn status_returns_none_when_no_tokens_saved() {
        let server = MockServer::start().await;
        let store = Arc::new(InMemoryStore::new());
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store, clock).await;
        assert!(svc.status().await.unwrap().is_none());
    }

    #[tokio::test]
    async fn status_returns_account_when_tokens_are_fresh() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/users/get_current_account"))
            .and(header("authorization", "Bearer access-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "account_id": "dbid:1",
                "email": "a@b",
                "name": {"display_name": "A B", "given_name": "A", "surname": "B"}
            })))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at: 2_000,
            account_id: "dbid:1".into(),
        }));
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store, clock).await;
        let account = svc.status().await.unwrap().unwrap();
        assert_eq!(account.account_id, "dbid:1");
        assert_eq!(account.display_name, "A B");
        assert_eq!(account.email, "a@b");
    }

    #[tokio::test]
    async fn expired_tokens_trigger_a_refresh_then_account_lookup() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("grant_type=refresh_token"))
            .and(body_string_contains("refresh_token=refresh-1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "access-2",
                "expires_in": 14_400,
                "token_type": "bearer"
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/users/get_current_account"))
            .and(header("authorization", "Bearer access-2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "account_id": "dbid:1",
                "email": "a@b",
                "name": {"display_name": "A B", "given_name": "A", "surname": "B"}
            })))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at: 1_000, // expired vs the clock below
            account_id: "dbid:1".into(),
        }));
        let clock = Arc::new(FixedClock::new(2_000));
        let svc = build_service(&server, store.clone(), clock).await;
        svc.status().await.unwrap().unwrap();

        let stored = store.load().unwrap().unwrap();
        assert_eq!(stored.access_token, "access-2");
        // refresh response had no refresh_token: previous one is preserved
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.expires_at, 2_000 + 14_400);
    }

    #[tokio::test]
    async fn list_folder_returns_typed_entries() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/list_folder"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "entries": [
                    {".tag": "folder", "name": "Photos", "path_lower": "/photos", "path_display": "/Photos"},
                    {".tag": "file", "name": "a.txt", "path_lower": "/a.txt", "path_display": "/a.txt", "size": 9, "server_modified": "2025-01-02T03:04:05Z"}
                ]
            })))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at: 9_000,
            account_id: "dbid:1".into(),
        }));
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store, clock).await;
        let entries = svc.list_folder("").await.unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "Photos");
        assert_eq!(entries[1].name, "a.txt");
        assert_eq!(entries[1].size, Some(9));
    }

    #[tokio::test]
    async fn list_folder_returns_not_connected_without_tokens() {
        let server = MockServer::start().await;
        let store = Arc::new(InMemoryStore::new());
        let clock = Arc::new(FixedClock::new(1));
        let svc = build_service(&server, store, clock).await;
        let err = svc.list_folder("").await.unwrap_err();
        assert!(matches!(err, ServiceError::NotConnected));
    }

    #[tokio::test]
    async fn list_folder_surfaces_api_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/list_folder"))
            .respond_with(ResponseTemplate::new(409).set_body_string("path/not_found"))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "access-1".into(),
            refresh_token: "refresh-1".into(),
            expires_at: 9_000,
            account_id: "dbid:1".into(),
        }));
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store, clock).await;
        match svc.list_folder("/missing").await.unwrap_err() {
            ServiceError::Api { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("path/not_found"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn exchange_code_parses_token_response_and_save_persists() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .and(body_string_contains("grant_type=authorization_code"))
            .and(body_string_contains("code=the-code"))
            .and(body_string_contains("code_verifier=the-verifier"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "a1",
                "refresh_token": "r1",
                "expires_in": 14_400,
                "token_type": "bearer",
                "account_id": "dbid:7",
                "scope": "files.metadata.read"
            })))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::new());
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store.clone(), clock).await;
        let resp = svc
            .exchange_code("the-code", "the-verifier", "http://127.0.0.1:1/callback")
            .await
            .unwrap();
        let saved = svc.save_initial_tokens(resp).unwrap();
        assert_eq!(saved.access_token, "a1");
        assert_eq!(saved.refresh_token, "r1");
        assert_eq!(saved.expires_at, 1_000 + 14_400);
        assert_eq!(saved.account_id, "dbid:7");
        assert_eq!(store.load().unwrap().unwrap(), saved);
    }

    #[tokio::test]
    async fn save_initial_tokens_errors_when_refresh_token_missing() {
        let server = MockServer::start().await;
        let store = Arc::new(InMemoryStore::new());
        let clock = Arc::new(FixedClock::new(1));
        let svc = build_service(&server, store, clock).await;
        let err = svc
            .save_initial_tokens(TokenResponse {
                access_token: "a".into(),
                refresh_token: None,
                expires_in: 60,
                token_type: "bearer".into(),
                account_id: None,
                scope: None,
            })
            .unwrap_err();
        match err {
            ServiceError::Decode(s) => assert!(s.contains("refresh_token")),
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn disconnect_clears_store_even_if_revoke_fails() {
        let server = MockServer::start().await;
        // No mocks → revoke call gets a 404; store should still be cleared.
        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at: 9_000,
            account_id: "x".into(),
        }));
        let clock = Arc::new(FixedClock::new(1_000));
        let svc = build_service(&server, store.clone(), clock).await;
        svc.disconnect().await.unwrap();
        assert!(store.load().unwrap().is_none());
    }

    #[tokio::test]
    async fn download_to_path_passes_path_in_dropbox_api_arg_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"x".to_vec()))
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dl.bin");
        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        svc.download_to_path("/Photos/sunset.jpg", &dest).await.unwrap();

        let received = server.received_requests().await.unwrap();
        let req = received
            .iter()
            .find(|r| r.url.path().ends_with("/files/download"))
            .expect("download request was issued");
        assert!(
            req.headers.contains_key("authorization"),
            "auth header missing"
        );
        let arg: serde_json::Value = serde_json::from_str(
            req.headers.get("dropbox-api-arg").unwrap().to_str().unwrap(),
        )
        .unwrap();
        assert_eq!(arg["path"], "/Photos/sunset.jpg");
    }

    #[tokio::test]
    async fn download_to_path_returns_not_connected_without_tokens() {
        let server = MockServer::start().await;
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dl.bin");
        let svc = build_service(
            &server,
            Arc::new(InMemoryStore::new()),
            Arc::new(FixedClock::new(1_000)),
        )
        .await;
        let err = svc.download_to_path("/x", &dest).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotConnected));
    }

    #[tokio::test]
    async fn download_to_path_streams_bytes_to_file() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(b"hello world".to_vec()),
            )
            .mount(&server)
            .await;

        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dl.bin");
        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let n = svc.download_to_path("/x.bin", &dest).await.unwrap();
        assert_eq!(n, 11);
        assert_eq!(std::fs::read(&dest).unwrap(), b"hello world");
    }

    #[tokio::test]
    async fn download_to_path_propagates_api_errors_without_writing() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(ResponseTemplate::new(409).set_body_string("path/not_found"))
            .mount(&server)
            .await;
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("dl.bin");
        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let err = svc.download_to_path("/missing", &dest).await.unwrap_err();
        assert!(matches!(err, ServiceError::Api { .. }));
        assert!(!dest.exists(), "no file should be created on API failure");
    }

    #[tokio::test]
    async fn get_thumbnail_returns_response_bytes() {
        let server = MockServer::start().await;
        // Body of the API arg JSON: easiest to assert via body_string_contains
        // since header value matchers expect a single exact string.
        Mock::given(method("POST"))
            .and(path("/2/files/get_thumbnail_v2"))
            .and(header("authorization", "Bearer access-1"))
            .respond_with(
                ResponseTemplate::new(200).set_body_bytes(b"\xff\xd8jpegbytes".to_vec()),
            )
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let bytes = svc.get_thumbnail("/Photos/x.jpg", "w256h256").await.unwrap();
        assert_eq!(bytes, b"\xff\xd8jpegbytes");
    }

    #[tokio::test]
    async fn get_thumbnail_sends_size_and_resource_in_arg_header() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/get_thumbnail_v2"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(b"x".to_vec()))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        svc.get_thumbnail("/x.jpg", "w128h128").await.unwrap();

        let received = server.received_requests().await.unwrap();
        let arg = received
            .iter()
            .find(|r| r.url.path().ends_with("/get_thumbnail_v2"))
            .expect("thumbnail request was issued")
            .headers
            .get("dropbox-api-arg")
            .expect("Dropbox-API-Arg header is set")
            .to_str()
            .unwrap()
            .to_string();
        let parsed: serde_json::Value = serde_json::from_str(&arg).unwrap();
        assert_eq!(parsed["format"], "jpeg");
        assert_eq!(parsed["mode"], "fitone_bestfit");
        assert_eq!(parsed["size"], "w128h128");
        assert_eq!(parsed["resource"][".tag"], "path");
        assert_eq!(parsed["resource"]["path"], "/x.jpg");
    }

    #[tokio::test]
    async fn get_thumbnail_surfaces_api_error() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/get_thumbnail_v2"))
            .respond_with(
                ResponseTemplate::new(409).set_body_string("not_image_content"),
            )
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.get_thumbnail("/x.txt", "w128h128").await.unwrap_err() {
            ServiceError::Api { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("not_image_content"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn read_text_capped_returns_some_on_success() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("hello world"),
            )
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let body = svc.read_text_capped("/x.txt", 1024).await.unwrap();
        assert_eq!(body.as_deref(), Some("hello world"));
    }

    #[tokio::test]
    async fn read_text_capped_returns_none_on_path_not_found() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(ResponseTemplate::new(409).set_body_string(
                r#"{"error_summary":"path/not_found/.","error":{".tag":"path","path":{".tag":"not_found"}}}"#,
            ))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        assert!(svc.read_text_capped("/missing", 1024).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn read_text_capped_propagates_other_api_errors() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(ResponseTemplate::new(409).set_body_string("path/malformed_path"))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.read_text_capped("/oops", 1024).await.unwrap_err() {
            ServiceError::Api { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("malformed_path"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn read_text_capped_rejects_oversized_payload() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(
                ResponseTemplate::new(200).set_body_string("12345678901234567890"),
            )
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.read_text_capped("/big", 8).await.unwrap_err() {
            ServiceError::Decode(msg) => assert!(msg.contains("cap"), "{msg}"),
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn read_text_capped_rejects_non_utf8() {
        let server = MockServer::start().await;
        // 0xFF is invalid UTF-8 start byte
        Mock::given(method("POST"))
            .and(path("/2/files/download"))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0xFF, 0xFE]))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.read_text_capped("/binary", 1024).await.unwrap_err() {
            ServiceError::Decode(_) => {}
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn read_text_capped_returns_not_connected_without_tokens() {
        let server = MockServer::start().await;
        let svc = build_service(
            &server,
            Arc::new(InMemoryStore::new()),
            Arc::new(FixedClock::new(1_000)),
        )
        .await;
        let err = svc.read_text_capped("/x", 1024).await.unwrap_err();
        assert!(matches!(err, ServiceError::NotConnected));
    }

    #[tokio::test]
    async fn move_path_sends_from_and_to_and_returns_typed_entry() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/move_v2"))
            .and(body_string_contains("\"from_path\":\"/a/x.png\""))
            .and(body_string_contains("\"to_path\":\"/b/x.png\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "metadata": {
                    ".tag": "file",
                    "name": "x.png",
                    "path_lower": "/b/x.png",
                    "path_display": "/b/x.png",
                    "size": 12,
                    "server_modified": "2025-01-02T03:04:05Z"
                }
            })))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let entry = svc.move_path("/a/x.png", "/b/x.png").await.unwrap();
        assert_eq!(entry.name, "x.png");
        assert_eq!(entry.path, "/b/x.png");
        assert_eq!(entry.size, Some(12));
    }

    #[tokio::test]
    async fn move_path_surfaces_to_conflict() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/move_v2"))
            .respond_with(ResponseTemplate::new(409).set_body_string(
                r#"{"error_summary":"to/conflict/file/.","error":{".tag":"to","to":{".tag":"conflict","conflict":{".tag":"file"}}}}"#,
            ))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.move_path("/a", "/b").await.unwrap_err() {
            ServiceError::Api { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("to/conflict"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn move_path_returns_not_connected_without_tokens() {
        let server = MockServer::start().await;
        let svc = build_service(
            &server,
            Arc::new(InMemoryStore::new()),
            Arc::new(FixedClock::new(1_000)),
        )
        .await;
        let err = svc.move_path("/a", "/b").await.unwrap_err();
        assert!(matches!(err, ServiceError::NotConnected));
    }

    #[tokio::test]
    async fn move_path_errors_when_metadata_tag_is_unknown() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/move_v2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "metadata": { ".tag": "deleted", "name": "x", "path_lower": "/x" }
            })))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.move_path("/a", "/b").await.unwrap_err() {
            ServiceError::Decode(msg) => assert!(msg.contains("unexpected .tag")),
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn create_folder_returns_typed_folder_entry() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/create_folder_v2"))
            .and(body_string_contains("\"path\":\"/Photos/2026\""))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "metadata": {
                    ".tag": "folder",
                    "name": "2026",
                    "path_lower": "/photos/2026",
                    "path_display": "/Photos/2026"
                }
            })))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        let entry = svc.create_folder("/Photos/2026").await.unwrap();
        assert_eq!(entry.name, "2026");
        // entry_from_raw nullifies size/server_modified for folders
        assert!(entry.size.is_none());
        assert!(entry.server_modified.is_none());
    }

    #[tokio::test]
    async fn create_folder_surfaces_path_conflict() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/2/files/create_folder_v2"))
            .respond_with(ResponseTemplate::new(409).set_body_string(
                r#"{"error_summary":"path/conflict/folder/.","error":{".tag":"path","path":{".tag":"conflict","conflict":{".tag":"folder"}}}}"#,
            ))
            .mount(&server)
            .await;

        let svc = build_service(&server, fresh_store(), Arc::new(FixedClock::new(1_000))).await;
        match svc.create_folder("/already-here").await.unwrap_err() {
            ServiceError::Api { status, body } => {
                assert_eq!(status, 409);
                assert!(body.contains("path/conflict"));
            }
            e => panic!("wrong error: {e:?}"),
        }
    }

    #[tokio::test]
    async fn create_folder_returns_not_connected_without_tokens() {
        let server = MockServer::start().await;
        let svc = build_service(
            &server,
            Arc::new(InMemoryStore::new()),
            Arc::new(FixedClock::new(1_000)),
        )
        .await;
        let err = svc.create_folder("/x").await.unwrap_err();
        assert!(matches!(err, ServiceError::NotConnected));
    }

    #[tokio::test]
    async fn fixed_clock_can_be_advanced_to_force_refresh_paths() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/oauth2/token"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "access_token": "fresh",
                "expires_in": 60,
                "token_type": "bearer"
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path("/2/users/get_current_account"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "account_id": "id",
                "email": "e",
                "name": {"display_name": "D", "given_name": "D", "surname": "D"}
            })))
            .mount(&server)
            .await;

        let store = Arc::new(InMemoryStore::with_tokens(StoredTokens {
            access_token: "old".into(),
            refresh_token: "r".into(),
            expires_at: 1_000,
            account_id: "id".into(),
        }));
        let clock = Arc::new(FixedClock::new(0));
        let svc = build_service(&server, store.clone(), clock.clone()).await;

        // Before expiry: no refresh
        svc.status().await.unwrap();
        assert_eq!(store.load().unwrap().unwrap().access_token, "old");

        // Advance past expiry: should refresh
        clock.set(2_000);
        svc.status().await.unwrap();
        assert_eq!(store.load().unwrap().unwrap().access_token, "fresh");
    }
}
