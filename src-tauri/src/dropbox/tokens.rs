#[cfg(test)]
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredTokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix-seconds expiry for the access token.
    pub expires_at: i64,
    pub account_id: String,
}

/// Hand-written `Debug` so that accidental `dbg!`/`{:?}`/panic messages never
/// leak the bearer or refresh token. Tests rely on this redaction; do not
/// switch back to `derive(Debug)` without rewiring those tests.
impl std::fmt::Debug for StoredTokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StoredTokens")
            .field("access_token", &"<redacted>")
            .field("refresh_token", &"<redacted>")
            .field("expires_at", &self.expires_at)
            .field("account_id", &self.account_id)
            .finish()
    }
}

impl StoredTokens {
    /// Treat tokens that expire within this many seconds as already expired,
    /// so we proactively refresh.
    pub const REFRESH_SKEW_SECS: i64 = 60;

    pub fn is_expired(&self, now_secs: i64) -> bool {
        self.expires_at - Self::REFRESH_SKEW_SECS <= now_secs
    }
}

/// Storage backend abstraction. Implementations are responsible for
/// persistence; the service treats reads/writes as cheap.
pub trait TokenStore: Send + Sync + 'static {
    fn load(&self) -> Result<Option<StoredTokens>, TokenStoreError>;
    fn save(&self, tokens: &StoredTokens) -> Result<(), TokenStoreError>;
    fn clear(&self) -> Result<(), TokenStoreError>;
}

#[derive(Debug, thiserror::Error)]
pub enum TokenStoreError {
    #[error("token storage I/O: {0}")]
    Io(String),
    #[error("token storage decode: {0}")]
    Decode(String),
}

// ---- keyring-backed implementation -------------------------------------

pub const KEYRING_SERVICE: &str = "dropbox-interface";
pub const KEYRING_USER: &str = "dropbox-tokens";

pub struct KeyringStore {
    service: String,
    user: String,
}

impl KeyringStore {
    pub fn new() -> Self {
        Self {
            service: KEYRING_SERVICE.to_string(),
            user: KEYRING_USER.to_string(),
        }
    }

    fn entry(&self) -> Result<keyring::Entry, TokenStoreError> {
        keyring::Entry::new(&self.service, &self.user)
            .map_err(|e| TokenStoreError::Io(e.to_string()))
    }
}

impl Default for KeyringStore {
    fn default() -> Self {
        Self::new()
    }
}

impl TokenStore for KeyringStore {
    fn load(&self) -> Result<Option<StoredTokens>, TokenStoreError> {
        let entry = self.entry()?;
        match entry.get_password() {
            Ok(s) => {
                let parsed: StoredTokens = serde_json::from_str(&s)
                    .map_err(|e| TokenStoreError::Decode(e.to_string()))?;
                Ok(Some(parsed))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(TokenStoreError::Io(e.to_string())),
        }
    }

    fn save(&self, tokens: &StoredTokens) -> Result<(), TokenStoreError> {
        let entry = self.entry()?;
        let json = serde_json::to_string(tokens)
            .map_err(|e| TokenStoreError::Decode(e.to_string()))?;
        entry
            .set_password(&json)
            .map_err(|e| TokenStoreError::Io(e.to_string()))
    }

    fn clear(&self) -> Result<(), TokenStoreError> {
        let entry = self.entry()?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(TokenStoreError::Io(e.to_string())),
        }
    }
}

// ---- in-memory test backend --------------------------------------------

#[cfg(test)]
#[derive(Default)]
pub struct InMemoryStore {
    inner: Mutex<Option<StoredTokens>>,
}

#[cfg(test)]
impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_tokens(tokens: StoredTokens) -> Self {
        Self {
            inner: Mutex::new(Some(tokens)),
        }
    }
}

#[cfg(test)]
impl TokenStore for InMemoryStore {
    fn load(&self) -> Result<Option<StoredTokens>, TokenStoreError> {
        Ok(self.inner.lock().unwrap().clone())
    }

    fn save(&self, tokens: &StoredTokens) -> Result<(), TokenStoreError> {
        *self.inner.lock().unwrap() = Some(tokens.clone());
        Ok(())
    }

    fn clear(&self) -> Result<(), TokenStoreError> {
        *self.inner.lock().unwrap() = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fake_tokens(expires_at: i64) -> StoredTokens {
        StoredTokens {
            access_token: "a".into(),
            refresh_token: "r".into(),
            expires_at,
            account_id: "dbid:42".into(),
        }
    }

    #[test]
    fn is_expired_returns_true_after_expiry() {
        let t = fake_tokens(1000);
        assert!(t.is_expired(1000));
        assert!(t.is_expired(2000));
    }

    #[test]
    fn is_expired_uses_refresh_skew() {
        let t = fake_tokens(1000);
        // exactly skew seconds before expiry: refresh proactively
        assert!(t.is_expired(1000 - StoredTokens::REFRESH_SKEW_SECS));
        // a touch before the skew window: still considered fresh
        assert!(!t.is_expired(1000 - StoredTokens::REFRESH_SKEW_SECS - 1));
    }

    #[test]
    fn in_memory_store_round_trips_tokens() {
        let store = InMemoryStore::new();
        assert!(store.load().unwrap().is_none());
        let t = fake_tokens(123);
        store.save(&t).unwrap();
        assert_eq!(store.load().unwrap(), Some(t.clone()));
        store.clear().unwrap();
        assert!(store.load().unwrap().is_none());
    }

    #[test]
    fn in_memory_store_overwrites_on_save() {
        let store = InMemoryStore::with_tokens(fake_tokens(1));
        store.save(&fake_tokens(2)).unwrap();
        assert_eq!(store.load().unwrap().unwrap().expires_at, 2);
    }

    #[test]
    fn debug_impl_redacts_access_and_refresh_tokens() {
        let t = StoredTokens {
            access_token: "TOTALLY_SECRET_ACCESS".into(),
            refresh_token: "TOTALLY_SECRET_REFRESH".into(),
            expires_at: 12345,
            account_id: "dbid:42".into(),
        };
        let dbg = format!("{t:?}");
        assert!(!dbg.contains("TOTALLY_SECRET_ACCESS"), "{dbg}");
        assert!(!dbg.contains("TOTALLY_SECRET_REFRESH"), "{dbg}");
        assert!(dbg.contains("<redacted>"));
        // Non-secret fields still show through for diagnostics.
        assert!(dbg.contains("12345"));
        assert!(dbg.contains("dbid:42"));
    }
}
