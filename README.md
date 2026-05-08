# Dropbox Interface

Desktop-first shell for browsing local folders (with Dropbox integration planned). Built with **Tauri 2**, **React 19**, **TypeScript**, **Vite**, and **shadcn/ui** (Nova / Radix).

## Prerequisites

- [Node.js](https://nodejs.org/) (npm)
- [Rust](https://www.rust-lang.org/tools/install) and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (needed for `npm run tauri dev` / `tauri build`)

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

## UI notes

- **Files** tab: lists directories via Rust commands (`default_local_root`, `list_directory`, `parent_directory`).
- **Terminal** tab: embedded **xterm.js** + **`portable-pty`**. Shell profile is selectable (Windows: PowerShell, Command Prompt, `pwsh`; macOS/Linux: login **`$SHELL`**, `/bin/sh`, `/bin/bash`) and stored under **`localStorage`** key `dropbox-interface:terminal-shell`. After you open Terminal once, the tab panel stays mounted so the **PTY session survives** switching to Files. `terminal_spawn` takes a **`shell`** id plus **`cols`** / **`rows`**; streams use **`terminal-output`** / **`terminal-exit`** events and **`terminal_write`** for input.
- **Photos** app: thumbnail grid backed by Tauri's **asset protocol** (`convertFileSrc` from `@tauri-apps/api/core`). Images stream straight into `<img>` instead of round-tripping through base64 — required scope `["**"]` is enabled in `tauri.conf.json` under `app.security.assetProtocol`, with the Cargo feature `tauri/protocol-asset`. Click a thumbnail to open a full-size preview; **Esc** or backdrop click closes it.
- **Error boundaries**: `ErrorBoundary` (`src/components/error-boundary.tsx`) wraps each app section and the application root, so a crash in one app doesn't blank the whole window.

## Tests

- **Frontend** uses **Vitest** + **React Testing Library** + **jsdom**. Tauri's `invoke`/`listen`/`convertFileSrc` are stubbed via test-only Vite aliases pointing at `src/test/tauri-core-mock.ts` and `src/test/tauri-event-mock.ts`. Tests register per-command handlers with `setInvokeHandler(...)`.
- **Rust** unit tests live alongside the source under `#[cfg(test)] mod tests { … }` and use the `tempfile` crate for filesystem fixtures.
- **CI** runs both suites plus `tsc --noEmit`, `vite build`, and `cargo clippy` on every push and PR (`.github/workflows/ci.yml`).

## shadcn/ui

Add components with:

```bash
npx shadcn@latest add <component> -y
```
