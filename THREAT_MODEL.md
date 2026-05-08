# Threat model

Living doc. Update when assumptions change. The goal is not to enumerate every
possible attack — it's to make the *decisions* explicit so future-us doesn't
forget why something is the way it is.

## Scope

**In scope.** Internal team tool used to review and shepherd creative content
through state-prefixed Dropbox folders (`1__Processing`, `2__ready`, …) on
trusted, single-user desktop machines.

**Out of scope.** B2B / B2C distribution, multi-tenant security, code-signing
release pipelines, untrusted user input from the public internet, mobile.

## Assets

| # | Asset                                       | Sensitivity |
|---|---------------------------------------------|-------------|
| 1 | Dropbox **access token** (short-lived, ~4h) | High        |
| 2 | Dropbox **refresh token** (long-lived)      | Critical    |
| 3 | Dropbox account identity / email            | Low         |
| 4 | Local filesystem contents the user browses  | Medium      |
| 5 | Dropbox content the user browses/downloads  | High        |
| 6 | Source code & build artifacts (this repo)   | High        |

The Dropbox **App key** is **not** an asset. PKCE flows ship the App key in
the desktop bundle by design; treat it like a public identifier.

## Trust boundaries

```
+----------------------+       PKCE        +-------------------+
|  user's machine      | <---------------> |  api.dropboxapi   |
|  + Dropbox Interface |  /files endpoints |  content.dropbox  |
+----------------------+                   +-------------------+
        |
        | OS keychain (libsecret / Keychain / Credential Manager)
        v
   StoredTokens
```

The webview/renderer is treated as **partly untrusted**: any third-party JS
(none today, but transitively via npm) could in principle try to read
filesystem paths or exfiltrate data. The Rust core is trusted.

## Decisions, with rationale

### D1. PKCE app key in the bundle is fine.
Public by design in the OAuth 2.0 PKCE profile. The verifier is generated per
flow and never stored. Compromise of the App key alone gives an attacker
nothing.

### D2. Tokens go in the OS keychain, not a dotfile.
`KeyringStore` writes JSON to libsecret / Keychain / Credential Manager. We
never persist tokens to disk in plaintext. We never log tokens (verified by
audit + redacted `Debug` impls on `StoredTokens` and `TokenResponse`; tests
guard against regression).

### D3. Loopback OAuth, not custom URI scheme.
A localhost-only `TcpListener` on a port in `53682..53782` catches the
redirect. The state parameter is a 32-char random token that we strictly
verify before accepting any code. Loopback servers are a documented OAuth
pattern for native apps and avoid the cross-platform fragility of custom URI
schemes.

### D4. Strict CSP.
`tauri.conf.json` ships a CSP that allows `connect-src` only to
`api.dropboxapi.com` + `content.dropboxapi.com` (plus the Vite dev origins);
`script-src 'self'` so injected scripts can't run; `frame-ancestors 'none'`,
`object-src 'none'`, `form-action 'none'`. `style-src` keeps
`'unsafe-inline'` because Tailwind v4 + shadcn rely on inline styles; we
accept the residual style-injection risk as low because we never render
untrusted HTML (no `dangerouslySetInnerHTML`).

### D5. Asset protocol scope is `["**"]`. Why and what mitigates it.
The Photos and Dropbox-preview features need to load image files from
arbitrary user-chosen paths and from `<os-temp>/dropbox-interface/preview/…`.
Restricting the scope would break those features without a security benefit
*against the threat we actually care about*: the principal of the desktop app
is the same human who could also `cat` those files in their shell. The CSP's
`connect-src` allowlist remains the primary defense against an XSS-driven
exfiltration.

### D6. HTTP request timeouts are non-negotiable.
`reqwest` is constructed with an explicit `connect_timeout` (15s) and
`timeout` (120s). A hung Dropbox connection should never wedge a Tauri
worker; this also limits how long an attacker controlling the network can
keep us in a half-open state.

### D7. Rust TLS via rustls, not native-tls.
`reqwest` is configured `default-features = false, features = ["json",
"rustls-tls"]`. Removes the OpenSSL dependency surface; rustls is
memory-safe and audited.

### D8. Renderer never builds HTML from Dropbox / filesystem strings.
All entry names, paths, error messages, and account fields are rendered via
React's text interpolation (which escapes). The only HTML we hand-build is
the loopback success/error page in Rust, which goes through `html_escape`.

### D9. Capabilities are minimal.
`src-tauri/capabilities/default.json`: `core:default`, `opener:default`,
`dialog:default`. No fs, shell-execute, or http permissions for the
renderer; all filesystem and network work happens behind named
`#[tauri::command]` functions whose inputs we control.

### D10. CI catches dependency drift.
`cargo audit --deny warnings`, `npm audit --audit-level=high --omit=dev`,
and `gitleaks` run on every push and PR. Drift in any of these fails the
build.

## Residual risks (accepted, with notes)

- **Supply chain.** `npm` and `cargo` install code from third parties. We
  pin via lockfiles and gate audit jobs on every push, but a compromised
  popular package could still land before an advisory exists. Mitigation:
  keep the dependency surface small, prefer first-party Tauri/Anthropic
  libraries, and vendor with caution.
- **OS keychain compromise.** If the user's keyring is unlocked and another
  process can read it, our refresh token is exfiltratable. This is the
  whole-OS threat model and out of our scope; we rely on the OS.
- **Webview vulnerabilities.** A WebKit2GTK/WKWebView/Edge zero-day could
  bypass our CSP. Mitigation: keep Tauri up to date.
- **No token zeroization in memory.** Tokens live in normal `String`s and
  may be paged to swap. Mitigation: full-disk encryption on team machines.
  Not adopting `secrecy` crate yet because the operational complexity isn't
  worth it for an internal tool.
- **PR review of new code.** None of the above helps if a teammate pastes a
  hardcoded token into source. Gitleaks plus convention is our bulwark.

## Things we explicitly do NOT do

- Render Dropbox shared links or remote HTML inside the app.
- Open user files with anything except the OS default opener for whitelisted
  protocols.
- Spawn arbitrary shells. The PTY accepts only the named shell IDs in
  `terminal-preferences.ts` (`bash`, `sh`, `login` on Unix; `powershell`,
  `cmd`, `pwsh` on Windows) — no user-supplied shell paths.
- Store tokens or app keys in localStorage, sessionStorage, IndexedDB, or
  cookies. The renderer never sees a Dropbox token.
- Send telemetry or analytics anywhere.

## How to update this doc

When you add a feature that touches network, filesystem, IPC, or
authentication, list the new assumption under "Decisions" with a one-line
rationale. If you accept a new residual risk, add it under "Residual risks"
and explain why we're OK with it. Reviewer's job is to push back when those
sections start growing without thought.
