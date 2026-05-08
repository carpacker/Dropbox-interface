use serde::Deserialize;
use url::Url;

pub const AUTHORIZE_URL: &str = "https://www.dropbox.com/oauth2/authorize";
pub const TOKEN_URL: &str = "https://api.dropboxapi.com/oauth2/token";
pub const REVOKE_URL: &str = "https://api.dropboxapi.com/2/auth/token/revoke";

/// Scopes the app requests at OAuth time.
///
/// Read scopes power browsing, thumbnails, and file download/preview.
/// `files.metadata.write` lets us rename/move/delete files + folders and
/// create new folders — required for the Promote action and the
/// "create missing state folder" affordance. We deliberately do NOT
/// request `files.content.write` (upload) because the app never
/// originates new file content from the renderer.
pub const REQUESTED_SCOPES: &[&str] = &[
    "account_info.read",
    "files.metadata.read",
    "files.metadata.write",
    "files.content.read",
];

#[derive(Debug, Clone)]
pub struct AuthorizeRequest<'a> {
    pub app_key: &'a str,
    pub redirect_uri: &'a str,
    pub code_challenge: &'a str,
    pub state: &'a str,
    pub scopes: &'a [&'a str],
}

/// Build the URL the user opens in a browser to authorize the app.
pub fn build_authorize_url(req: &AuthorizeRequest<'_>) -> Url {
    let mut url = Url::parse(AUTHORIZE_URL).expect("hard-coded constant is valid");
    url.query_pairs_mut()
        .clear()
        .append_pair("client_id", req.app_key)
        .append_pair("response_type", "code")
        .append_pair("code_challenge_method", "S256")
        .append_pair("code_challenge", req.code_challenge)
        .append_pair("redirect_uri", req.redirect_uri)
        .append_pair("state", req.state)
        .append_pair("token_access_type", "offline")
        .append_pair("scope", &req.scopes.join(" "));
    url
}

/// Token response from Dropbox /oauth2/token (matches both the initial
/// authorization-code exchange and a refresh-token exchange).
#[derive(Clone, Deserialize)]
#[allow(dead_code)] // token_type / scope kept for diagnostics
pub struct TokenResponse {
    pub access_token: String,
    /// Present on initial exchange when `token_access_type=offline`.
    /// Absent on refresh; in that case we keep the previously-saved value.
    #[serde(default)]
    pub refresh_token: Option<String>,
    pub expires_in: u64,
    /// "bearer"
    pub token_type: String,
    /// Dropbox-specific identifier; useful for logging/diagnostics.
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
}

/// Hand-written `Debug` mirrors `StoredTokens` to keep raw bearer / refresh
/// values out of any panic message or `dbg!` call.
impl std::fmt::Debug for TokenResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TokenResponse")
            .field("access_token", &"<redacted>")
            .field(
                "refresh_token",
                &self.refresh_token.as_deref().map(|_| "<redacted>"),
            )
            .field("expires_in", &self.expires_in)
            .field("token_type", &self.token_type)
            .field("account_id", &self.account_id)
            .field("scope", &self.scope)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn query_map(url: &Url) -> HashMap<String, String> {
        url.query_pairs()
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect()
    }

    #[test]
    fn authorize_url_has_expected_origin_and_path() {
        let url = build_authorize_url(&AuthorizeRequest {
            app_key: "abc",
            redirect_uri: "http://127.0.0.1:53682/callback",
            code_challenge: "challenge",
            state: "xyz",
            scopes: REQUESTED_SCOPES,
        });
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("www.dropbox.com"));
        assert_eq!(url.path(), "/oauth2/authorize");
    }

    #[test]
    fn authorize_url_includes_all_required_query_params() {
        let url = build_authorize_url(&AuthorizeRequest {
            app_key: "abc",
            redirect_uri: "http://127.0.0.1:53682/callback",
            code_challenge: "the-challenge",
            state: "the-state",
            scopes: REQUESTED_SCOPES,
        });
        let q = query_map(&url);
        assert_eq!(q.get("client_id").map(String::as_str), Some("abc"));
        assert_eq!(q.get("response_type").map(String::as_str), Some("code"));
        assert_eq!(
            q.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            q.get("code_challenge").map(String::as_str),
            Some("the-challenge")
        );
        assert_eq!(
            q.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:53682/callback")
        );
        assert_eq!(q.get("state").map(String::as_str), Some("the-state"));
        assert_eq!(
            q.get("token_access_type").map(String::as_str),
            Some("offline")
        );
        assert_eq!(
            q.get("scope").map(String::as_str),
            Some(
                "account_info.read files.metadata.read \
                 files.metadata.write files.content.read"
            )
        );
    }

    #[test]
    fn authorize_url_url_encodes_special_characters() {
        let url = build_authorize_url(&AuthorizeRequest {
            app_key: "abc",
            redirect_uri: "http://127.0.0.1:53682/callback?x=1",
            code_challenge: "a+b/c=",
            state: "with spaces",
            scopes: REQUESTED_SCOPES,
        });
        let raw = url.as_str();
        // values must round-trip through query_pairs; that itself is the
        // strongest guarantee of encoding correctness
        let q = query_map(&url);
        assert_eq!(
            q.get("redirect_uri").map(String::as_str),
            Some("http://127.0.0.1:53682/callback?x=1")
        );
        assert_eq!(q.get("code_challenge").map(String::as_str), Some("a+b/c="));
        assert_eq!(q.get("state").map(String::as_str), Some("with spaces"));
        // sanity: spaces in raw URL must be percent-encoded, not literal
        assert!(!raw.contains(" "), "raw URL should not contain raw space");
    }

    #[test]
    fn token_response_deserializes_full_payload() {
        let body = r#"{
            "access_token": "abc",
            "refresh_token": "def",
            "expires_in": 14400,
            "token_type": "bearer",
            "account_id": "dbid:42",
            "scope": "account_info.read files.metadata.read"
        }"#;
        let parsed: TokenResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.access_token, "abc");
        assert_eq!(parsed.refresh_token.as_deref(), Some("def"));
        assert_eq!(parsed.expires_in, 14400);
        assert_eq!(parsed.token_type, "bearer");
        assert_eq!(parsed.account_id.as_deref(), Some("dbid:42"));
    }

    #[test]
    fn token_response_deserializes_refresh_payload_without_refresh_token() {
        // Refresh response: refresh_token + account_id + scope are typically absent.
        let body = r#"{
            "access_token": "new",
            "expires_in": 14400,
            "token_type": "bearer"
        }"#;
        let parsed: TokenResponse = serde_json::from_str(body).unwrap();
        assert_eq!(parsed.access_token, "new");
        assert!(parsed.refresh_token.is_none());
        assert!(parsed.account_id.is_none());
    }

    #[test]
    fn token_response_debug_redacts_secrets() {
        let r = TokenResponse {
            access_token: "TOTALLY_SECRET_ACCESS".into(),
            refresh_token: Some("TOTALLY_SECRET_REFRESH".into()),
            expires_in: 14400,
            token_type: "bearer".into(),
            account_id: Some("dbid:42".into()),
            scope: Some("files.metadata.read".into()),
        };
        let dbg = format!("{r:?}");
        assert!(!dbg.contains("TOTALLY_SECRET_ACCESS"), "{dbg}");
        assert!(!dbg.contains("TOTALLY_SECRET_REFRESH"), "{dbg}");
        assert!(dbg.contains("<redacted>"));
        assert!(dbg.contains("14400"));
        assert!(dbg.contains("dbid:42"));
    }
}
