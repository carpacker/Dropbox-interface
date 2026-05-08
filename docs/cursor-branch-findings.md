# Findings from `cursor/dashboard-photos-viewer`

**Status:** the branch was effectively abandoned in a broken state — `src/App.tsx`
held an unresolved merge with two stacked `import { … } from "lucide-react"`
blocks (the second one missing its opening `{`). It would not have compiled.
This document is the post-mortem before we delete the remote ref so nothing
useful gets lost.

The branch ran in parallel with the work that became PR #3 on `main`. The
two histories meet at `f5d2413` (the original PR #1 baseline) and then
diverge — `main` got pipelines + Promote + the security pass; the cursor
branch got an embedded HTTP server, a parallel Dropbox implementation, and
a dashboard customization mode.

This doc summarizes:

1. The shape of every commit on the cursor branch
2. Architectural ideas worth keeping
3. Concrete code worth porting
4. Things we explicitly **must not** port (and why)

---

## Commit-by-commit overview

Listed newest → oldest. Commit hashes will resolve until the cursor branch
is deleted; capture them now if you want to reference them later.

| Commit | Title | What it adds |
| --- | --- | --- |
| `e065fff` | Merge branch 'main' into cursor/dashboard-photos-viewer | Botched merge — left `App.tsx` syntactically invalid. |
| `798d2fe` | refactor(web-bridge): harden HTTP handlers and unify client helpers | Hardening on the embedded HTTP server (still missing the fundamentals — see below). |
| `da3d440` | feat(web-bridge): add /api/bridge/info, persist default open folder in Web UI | More HTTP endpoints. |
| `adff4af` | feat(web-bridge): layout command, open-app payload + folder seed | More HTTP endpoints. |
| `d880540` | feat(photos): persistenceKey scopes + internal tile size defaults | Lets a Photos instance namespace its localStorage keys so multiple embeds don't clash. |
| `656ea6f` | feat: internal subapplications dashboard + embedded photo module | The categorical "subapps" concept (Social Media, Studio, Field, Photos, Assets). |
| `20615ad` | feat(web-bridge): dashboard edit commands from HTTP clients | HTTP-driven dashboard mutation. |
| `b9b3824` | fix(dashboard): default-unlock layout + grip drag handle + shell polish | Drag-reorder polish. |
| `f6bca04` | fix(web-bridge): mutable request borrow + dashboard/open-app interop | Bug fixes inside the bridge. |
| `7992905` | Add web bridge runtime and dashboard state endpoint | Initial `tiny_http` server inside the Tauri process. |
| `ff5e7e2` | Add dynamic dashboard edit mode controls | Drag/lock/reset dashboard layout, persisted to localStorage. |
| `1bd426b` | Show detailed Dropbox sync change history | UI for `/files/list_folder/continue` longpoll-style change log. |
| `0b464cf` | Add Dropbox slideshow and sync checkpoint features | Slideshow inside their Dropbox browser. |
| `044f1b1` | Add Dropbox OAuth explorer with file actions | Their parallel Dropbox implementation (predates ours). |
| `bf7d412` | Add slideshow mode to photo viewer | Local-FS Photos slideshow + keyboard nav. **Ports cleanly.** |
| `3362c7c` | Expand photo viewer supported image formats | Adds `svg`, `avif`, `ico`, `tiff` to the supported list. |

---

## Architectural ideas worth keeping

These are concepts, not code. Each is worth keeping in mind for future
rounds even though we don't port the implementation directly.

### 1. "Internal subapplications" as a categorical layer above pipelines

`src/lib/internal-apps.ts` (cursor branch) defines a registry of
top-level *workspace categories* with stable ids and metadata:

```ts
export type InternalAppId =
  | "social_media"
  | "shoots_field"
  | "shoots_studio"
  | "photos"
  | "assets";

export const INTERNAL_APP_DEFINITIONS: InternalAppDefinition[] = [
  { id: "social_media", title: "Social media", icon: Share2,  ... },
  { id: "shoots_field", title: "Shoots (Field)", icon: Mountain, ... },
  { id: "shoots_studio", title: "Shoots (Studio)", icon: Camera, ... },
  { id: "photos", title: "Photos", icon: Images, ... },
  { id: "assets", title: "Assets", icon: Box, ... },
];
```

This anticipates the categorical structure the team described:

- **ARTISTS** ≈ shoots_studio + shoots_field combined
- **SOCIAL MEDIA** = social_media
- **ASSETS** = assets

It complements (rather than competes with) the pipeline model:

- The **pipeline lib** (`src/lib/pipeline/`) describes the *states* an item
  passes through inside one folder (`1__Processing` → `2__ready` → ...).
- An **internal-apps registry** would describe the *category* the folder
  belongs to (Social vs Shoots vs Assets) at the top level.

#### Recommendation

When we eventually want a richer dashboard than "list of recent
pipelines + flat app cards," lean on this pattern: a typed registry of
top-level categories, each with a default folder path and (optionally)
a default pipeline config. The dashboard becomes "pick a category →
land in that category's pipeline." Still pure config, still
backend-agnostic.

We should NOT port the cursor branch's implementation directly because
it's intertwined with the broken web-bridge and the parallel Dropbox
implementation, but the **mental model** is right and worth designing
toward.

### 2. Dashboard edit mode (drag + lock + persist)

`ff5e7e2` added a "Edit dashboard" button that toggles a mode where
users can drag-reorder cards and resize them (compact / wide / tall),
with the layout persisted to:

- `dropbox-interface:dashboard-layout-v1` — order + sizes
- `dropbox-interface:dashboard-edit-locked` — lock toggle

`b9b3824` polished it: layout starts unlocked, a `GripVertical` icon
gives a clear drag affordance, plus a "Reset" button.

The implementation lives entirely in `App.tsx` (~330 added lines) —
self-contained, no Tauri dependencies, no scope changes.

#### Recommendation

Worth porting eventually as its own small feature round. The
prerequisite is having more than 3-4 dashboard cards (which we'd
naturally hit once we add per-category subapps from idea #1 and any
future widgets like a recent-changes feed).

### 3. `persistenceKey` scopes for the Photos app

`d880540` parameterized the Photos app's localStorage keys with a
`persistenceKey` prop. Without this, two embeds of the Photos
component (e.g. one in the dashboard, one in a sidebar) would clobber
each other's state.

```tsx
type PhotosAppProps = {
  persistenceKey?: string;
  defaultTileSize?: "compact" | "regular";
};
```

#### Recommendation

Adopt this pattern when (and only when) we have a use case for two
Photos instances. Until then, YAGNI. The pattern itself — namespaced
localStorage keys passed as a prop — is a clean way to make
"persisted state" composable.

---

## Concrete code worth porting

### Photo viewer slideshow + keyboard navigation (`bf7d412`)

Self-contained, additive, doesn't touch the asset protocol or any
security surface. Three pieces:

1. **Slideshow:** play/pause toggle, 2200ms interval, wraps around the
   end of the current folder.
2. **Keyboard navigation:**
   - `Space` — play/pause slideshow
   - `Esc` — stop slideshow / close preview
   - `←` / `→` — prev/next image
   - `↑` / `↓` — prev/next *row* in the thumbnail grid
3. **Auto-advance** while slideshow is playing.

The cursor-branch implementation also adds eager-load thumbnail
preloading via base64 — we **don't** port that, because we already use
the asset protocol for streaming. The slideshow logic itself maps
cleanly onto our existing `imageEntries`/`selectedPath` state.

Port plan (folded into commit 3 of this PR):

- Add `Pause` + `Play` icon imports
- Add `selectedIndex` derived state
- Add `advanceBy(delta)` helper
- Add `isSlideshowPlaying` state + `toggleSlideshow` / `stopSlideshow`
- Add a single `useEffect` for the `setInterval`
- Add a single `useEffect` for the keyboard listener
- Add Play/Pause button to the lightbox header (only when there are
  images and the user is in the lightbox)
- Skip the eager-load and the thumbnail-grid changes; we already have
  better thumbnails via asset protocol

### Expanded image formats (`3362c7c`)

The cursor branch widened the supported set to include `svg`, `avif`,
`ico`, `tiff`. Trivial change — three lines in `src-tauri/src/lib.rs`
and a small extension to `tauri-fs.ts` `IMAGE_EXTENSIONS`.

**Decision: not porting in this round.** Two reasons:

1. SVG over the asset protocol is fine for trusted local files, but
   SVG can carry script. Expanding the format set without a CSP review
   is exactly the kind of "small change with security implications"
   we should think twice about.
2. AVIF/TIFF support varies by webview; we'd want to verify in the
   actual Tauri webview before claiming support.

Capture as a backlog item.

### Detailed Dropbox sync change history (`1bd426b`)

The cursor branch's Dropbox UI shows a per-item history panel powered
by `/files/list_folder/continue`. Conceptually interesting (longpoll
diff log), but the implementation is built on the cursor branch's
parallel Dropbox library which we're discarding. Re-implementing
against our `DropboxService` is a feature round of its own — capture
the UI idea, leave the code.

---

## Things we explicitly do NOT port

These conflict with `THREAT_MODEL.md` decisions or our existing
implementation. Listing the full rationale here so future contributors
don't try to revive them without understanding what they cost.

### `src-tauri/src/web_bridge.rs` (web-bridge HTTP server)

Adds a `tiny_http` server inside the Tauri process that lets external
HTTP clients drive the dashboard, open apps, mutate layout, etc.

**Why it's a non-starter for this app, even with the hardening
in `798d2fe`:**

- **Configurable bind address.** The runtime accepts an arbitrary
  `bind_addr` string; nothing forces `127.0.0.1`. A user (or an
  attacker who can write to settings) could point it at `0.0.0.0` and
  expose the surface to the local network.
- **API key is optional.** Empty key = no authentication. The default
  experience has no auth.
- **Plain HTTP.** No TLS, so even on localhost the API key is plaintext
  to anything reading the loopback interface (most desktop OS sandboxes
  prevent this, but we don't want to depend on it).
- **Cross-origin allow-list is a string.** A misconfiguration to `*`
  would let any web page call the API via CORS.
- **Threat-model violation.** `THREAT_MODEL.md` §D8/§D9 explicitly say
  the trust boundary is "user → Tauri webview → Rust core → Dropbox" —
  there is no inbound network listener. Adding one would invalidate
  several of the existing security assumptions (CSP `connect-src`,
  capability minimality, the "renderer never originates new bytes"
  rule).

**If we ever genuinely need this** (e.g. for a CLI helper or a
companion mobile app), the right shape is:

1. Bind hard-coded to `127.0.0.1` only.
2. API key required, generated at first run, rotated on demand.
3. Authenticated via HMAC of the request body, not a query
   parameter (Bearer headers are exposable in browser devtools).
4. Documented set of allowed commands; refuse anything not on the
   list.
5. Updated threat model documenting the new attack surface.

That's its own focused PR with the security review baked in. Not
something to inherit unreviewed.

### `src/components/dropbox-browser-app.tsx` + `src/lib/dropbox.ts`

Their parallel Dropbox implementation. Specifically:

- Uses `fetch` directly from the **renderer process**, with a raw
  bearer token in JS memory. Our implementation keeps tokens in the
  OS keychain (Rust) and the renderer never sees the bearer.
- No PKCE — they use Dropbox's "Generate access token" UI which
  hard-codes a long-lived token. Ours uses PKCE with refresh.
- No CSRF protection on OAuth (no `state` parameter validation).
- No size cap on file downloads, no streaming for large files.

This is the "easy path for development" Dropbox integration — fine
for prototyping, unsafe to ship. Our `DropboxService` is the version
to keep.

### `src/components/web-interface-app.tsx`

UI for configuring the web bridge. Useless without the bridge.

### `src/components/internal-app-shell.tsx` + `src/components/internal-subapplications.tsx`

These wrap subapps with a styled `Card` shell. The visual concept is
fine, but the implementation hard-codes references to specific subapp
IDs and uses `web-bridge.ts` callbacks for cross-app communication.
We adopt the *concept* (registry of typed subapps) — see
"Architectural ideas" §1 — without the implementation.

### Cursor-branch's `lib.rs` revision

Their merge resolution **deleted** every `dropbox::commands::*`
registration from `invoke_handler!`. If we'd merged, the entire
Dropbox + pipeline feature set would have been silently disabled at
runtime even though the code still exists in the tree. This is a good
example of why we want to delete the branch rather than try to
salvage piecemeal — its merge is a landmine.

---

## Architecture decisions, restated for the record

The cursor branch's existence forced us to articulate things that were
implicit before. Pinning them down:

1. **No inbound network surface.** The Tauri app makes outbound calls
   only (Dropbox API). Anything else is a deliberate decision that
   updates `THREAT_MODEL.md`.
2. **Tokens never live in the renderer.** OAuth flows happen in Rust;
   the renderer talks to typed Tauri commands. If we ever break this
   rule, document why.
3. **Dropbox features build on `DropboxService`** (the Rust HTTP +
   keyring + refresh layer in `src-tauri/src/dropbox/`). New features
   (slideshow inside Dropbox, change history, etc.) extend that layer
   rather than re-implementing the auth.
4. **The dashboard is locally-driven.** State lives in localStorage
   under namespaced keys (`dropbox-interface:*`). Layout customization
   is fine; remote control is not.
5. **The pipeline lib stays generic.** It doesn't know about Dropbox
   or local FS — sources implement `PipelineSource`. New backends
   (e.g. the local-FS pipelines we keep deferring) add a new source,
   not a fork of the lib.

---

## Backlog captured from this review

Items the cursor branch surfaced that we may want later:

- [ ] Internal-apps registry pattern (§"Architectural ideas" #1) when
      the dashboard outgrows the current 3-card layout.
- [ ] Dashboard edit mode (drag/resize/lock/reset) when there are
      enough cards for ordering to matter.
- [ ] Photos slideshow + keyboard nav — **porting in this PR.**
- [ ] Wider image format support (svg/avif/tiff) — needs a CSP review
      for SVG specifically.
- [ ] Per-instance Photos `persistenceKey` if we ever embed multiple
      Photos surfaces.
- [ ] Dropbox folder change history UI — would be a feature on top of
      `DropboxService`'s existing `list_folder` (using
      `/files/list_folder/continue`).

If any of these become priorities, they each merit their own focused
PR with tests + threat-model touch-up where applicable.
