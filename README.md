# Dropbox Interface

Desktop-first shell for browsing local folders and your Dropbox account from one window. Built with **Tauri 2**, **React 19**, **TypeScript**, **Vite**, and **shadcn/ui** (Nova / Radix).

## Prerequisites

- [Node.js](https://nodejs.org/) (npm)
- [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (needed for `npm run tauri dev` / `tauri build`)
- On Linux, the keyring backend requires `libsecret-1-dev` and `libdbus-1-dev` plus a running Secret Service provider (GNOME Keyring, KWallet, etc.). On macOS it uses Keychain; on Windows it uses Credential Manager.

## Configuration

Copy `.env.example` to `.env.local` and set:

```
VITE_DROPBOX_APP_KEY=<your-app-key>
```

Register your app at <https://www.dropbox.com/developers/apps> ("Scoped access" → pick App folder or Full Dropbox). PKCE doesn't use a client secret, so the key is safe to ship. Until the variable is populated, the Dropbox tab shows a setup prompt; the rest of the app works without it.

## Scripts

| Command | Description |
| --- | --- |
| `npm install` | Install JavaScript dependencies |
| `npm run dev` | Vite dev server only (filesystem commands need the Tauri shell) |
| `npm run tauri dev` | Desktop app with hot reload |
| `npm run build` | Typecheck + Vite production build |
| `npm run tauri build` | Build the installable desktop bundle |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Vitest with v8 coverage |

For the Rust side: `cd src-tauri && cargo test` and `cargo clippy --all-targets -- -D warnings`.

## Apps

- **Files** tab (Workspace): lists directories via Rust commands (`default_local_root`, `list_directory`, `parent_directory`). Each file row shows size + relative-modified time. The **Sort** dropdown (Name / Modified / Size, asc/desc) is shared with every other listing surface; the choice persists to `localStorage` under `dropbox-interface:sort-preference-v1`. A **Filter** chip narrows the visible list by case-insensitive substring (multi-token: every token must match); filter state is per-listing and clears on every navigation.
  - **Local pipelines.** Drop a `.dropbox-interface.json` into any folder you browse here and the Files tab swaps to the same `PipelineView` the Dropbox tab uses — bucket strip, lazy bucket loads, Promote (via `local_move`), missing-state Create-folder (via `local_create_folder`), Undo, drag-to-bucket, bulk Promote, notes, and keyboard nav. Local pipelines don't surface Save-to-disk or Delete (the file browser is already your disk; destructive verbs land deliberately). Backed by `LocalPipelineSource` + `LocalPipelineOperator`, both behind the same `PipelineSource` / `PipelineOperator` seams the Dropbox tab uses.
- **Settings** (gear icon in the header): modal with two sections — **Theme** (Light / Dark / System; "System" tracks `prefers-color-scheme` and re-applies on change) and **Dashboard layout** (Stacked / Grid / Compact). Choices persist to `localStorage` under `dropbox-interface:settings-v1` and apply instantly. Theme toggles `.dark` on `<html>`; layout is a Tailwind-class swap on the dashboard grid container.
- **Terminal** tab (Workspace): embedded **xterm.js** + **`portable-pty`**. Shell profile is selectable (Windows: PowerShell, Command Prompt, `pwsh`; macOS/Linux: login **`$SHELL`**, `/bin/sh`, `/bin/bash`) and stored under **`localStorage`** key `dropbox-interface:terminal-shell`. After you open Terminal once, the tab panel stays mounted so the **PTY session survives** switching to Files. `terminal_spawn` takes a **`shell`** id plus **`cols`** / **`rows`**; streams use **`terminal-output`** / **`terminal-exit`** events and **`terminal_write`** for input.
- **Photos**: thumbnail grid backed by Tauri's **asset protocol** (`convertFileSrc` from `@tauri-apps/api/core`). Images stream straight into `<img>` instead of round-tripping through base64 — required scope `["**"]` is enabled in `tauri.conf.json` under `app.security.assetProtocol`, with the Cargo feature `tauri/protocol-asset`. Click a thumbnail to open a full-size preview. Inside the lightbox: `←` / `→` navigate, `↑` / `↓` jump by row, `Space` plays/pauses the slideshow (2.2s/image, wraps), `Esc` stops the slideshow then closes the lightbox.
- **Dropbox**: read-only browser for your remote folders. PKCE OAuth flow (no client secret); tokens (access + refresh) are stored in your OS keychain via the `keyring` crate, refreshed automatically when expired, and revoked on disconnect. Scopes requested: `account_info.read`, `files.metadata.read`, `files.content.read`. Image entries show inline thumbnails fetched via `/files/get_thumbnail_v2` (delivered as base64 data URLs). Click an image to open a lightbox preview; the file streams via `/files/download` to a deterministic per-path temp file under the OS temp dir, then loads through Tauri's asset protocol. Every file row has a **Save** button that opens an OS save dialog (via `tauri-plugin-dialog`) and streams the bytes directly to your chosen destination, plus a **Delete** trash icon that opens a destructive confirm modal (`/files/delete_v2`; reversible via Dropbox trash for 30 days, files only, see [`THREAT_MODEL.md`](THREAT_MODEL.md) §D8e). Backed by `src-tauri/src/dropbox/` — see `service.rs` for the testable HTTP layer and `loopback.rs` for the redirect catcher.
  - **State-aware pipelines**: drop a `.dropbox-interface.json` in any folder to declare a pipeline (e.g. `1__Processing` → `2__ready` → `3__published`). The Dropbox app auto-detects the config and switches to a tab-strip view with per-state buckets plus an Inbox bucket for unfiled items. State folder listings load lazily on bucket selection. Each item gets a **Promote** button that moves it to the next state (or, for Inbox items, files them into the first state) via `/files/move_v2`; you can also **drag the row onto any other bucket chip** to land it there. Every successful move shows an Undo toast (8s auto-dismiss, one-click reverse). Missing state folders surface as a non-blocking warning with a one-click **Create folder** button (`/files/create_folder_v2`). Read scopes plus `files.metadata.write`; uploads (`files.content.write`) are deliberately not requested. See [`docs/architecture/pipelines.md`](docs/architecture/pipelines.md) for the schema and decisions.
  - **Recent pipelines**: the dashboard shows a quick-launch card listing the last 5 pipelines you opened (deduped by path, MRU first), persisted to `localStorage`. Clicking one jumps straight into the Dropbox app at that path. **Pin** any row (or use the pin button in the pipeline header) to keep important pipelines from being evicted; pinned entries sort first.
  - **Bulk Promote**: each pipeline row carries a checkbox; selection is kept per-bucket so you can flip between Processing/Ready/etc. without losing it. With ≥1 item selected, a toolbar exposes `Promote N to <next>` plus Clear. Moves run in parallel; partial failure shows a count and successful moves still group under a single batch Undo.
  - **Local-only notes**: each row gets a Note button that opens a small editor (textarea + Save/Cancel). Notes are keyed by Dropbox path and stored in `localStorage` only — see [`THREAT_MODEL.md`](THREAT_MODEL.md) §D8d for why we don't round-trip them through Dropbox. An empty save deletes the note.
  - **List vs Gallery view**: each pipeline can flip between a row list (default) and a thumbnail gallery sized for image review. Choice persists per pipeline path under `dropbox-interface:pipeline-view-mode:v1`. Gallery tiles use `w256h256` Dropbox thumbnails and keep all the same affordances (Promote, Save, Note, Delete, multi-select, drag).
  - **Keyboard navigation**: click into the active bucket panel, then `j`/`k` (or arrows) move focus, `g`/`G` jump to top/bottom, `Enter` previews an image / opens a folder, `Space` toggles selection, `p` promotes the focused row (or the multi-selection if any), `Esc` unwinds (filter → selection), `?` opens a cheatsheet. Letter keys typed inside the filter chip stay in the input.
- **Error boundaries**: `ErrorBoundary` (`src/components/error-boundary.tsx`) wraps each app section and the application root.

## Tests

- **Frontend** uses **Vitest** + **React Testing Library** + **jsdom**. Tauri's `invoke`/`listen`/`convertFileSrc` are stubbed via test-only Vite aliases pointing at `src/test/tauri-core-mock.ts` and `src/test/tauri-event-mock.ts`. Tests register per-command handlers with `setInvokeHandler(...)`.
- **Rust** unit tests live alongside the source under `#[cfg(test)] mod tests { … }`. Pure helpers (PKCE, URL building, response parsing, sort/filter logic) are tested directly. `service.rs` is tested against a `wiremock` server with an `InMemoryStore` standing in for the keyring and a `FixedClock` for refresh timing.
- **CI** runs both suites plus `tsc --noEmit`, `vite build`, and `cargo clippy` on every push and PR (`.github/workflows/ci.yml`). Tauri Linux deps including `libsecret-1-dev` are installed for the Rust job.

## Architecture docs

- [`docs/architecture/pipelines.md`](docs/architecture/pipelines.md) — state-aware folder pipelines (the `1__Processing` / `2__ready` review workflow). Model layer is in `src/lib/pipeline/` and is backend-agnostic (`PipelineSource` is the seam). UI + Dropbox source land in follow-up rounds.
- [`THREAT_MODEL.md`](THREAT_MODEL.md) — security decisions and accepted residual risks. Update when a feature touches network, filesystem, IPC, or auth.

## shadcn/ui

Add components with:

```bash
npx shadcn@latest add <component> -y
```
