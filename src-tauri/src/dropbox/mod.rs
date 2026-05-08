//! Dropbox OAuth (PKCE) + Files API integration.
//!
//! Layout:
//! - `pkce`     — PKCE verifier/challenge generation and validation
//! - `oauth`    — authorize-URL building and token-exchange request shapes
//! - `api`      — typed responses for the subset of the Dropbox /2 API we use
//! - `tokens`   — `TokenStore` trait + keyring-backed implementation
//! - `loopback` — tiny localhost HTTP server that catches the redirect
//! - `service`  — high-level `DropboxService` that ties storage + http together
//! - `commands` — `#[tauri::command]` wrappers exposed to the frontend
//!
//! Pure helpers (pkce/oauth/api parsing) have no I/O so they are unit-tested
//! directly. The service is tested by injecting a fake `TokenStore` and a
//! `wiremock` server in place of `api.dropboxapi.com`.

pub mod api;
pub mod commands;
pub mod loopback;
pub mod oauth;
pub mod pkce;
pub mod service;
pub mod tokens;

pub use commands::DropboxState;
