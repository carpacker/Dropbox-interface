use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::Client;
use serde_json::json;

use super::api::{
    entries_from_raw, AccountResponse, DropboxAccount, DropboxEntry, ListFolderResponse,
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
/// `wiremock` server. In production both URLs point at api.dropboxapi.com.
#[derive(Clone)]
pub struct ApiEndpoints {
    pub token_url: String,
    pub revoke_url: String,
    pub api_base: String,
}

impl Default for ApiEndpoints {
    fn default() -> Self {
        Self {
            token_url: TOKEN_URL.to_string(),
            revoke_url: REVOKE_URL.to_string(),
            api_base: "https://api.dropboxapi.com/2".to_string(),
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
            http: Client::new(),
            store,
            clock: Arc::new(SystemClock),
            endpoints: ApiEndpoints::default(),
            app_key: app_key.into(),
        }
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
            http: Client::new(),
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
        let tokens = self.store.load()?.ok_or(ServiceError::NotConnected)?;
        let access = self.access_token_refreshing_if_needed(tokens).await?;
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
        };
        DropboxService::with_test_doubles(store, clock, endpoints, "test-key")
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
