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

## UI notes

- **Files** tab: lists directories via Rust commands (`default_local_root`, `list_directory`, `parent_directory`).
- **Terminal** tab: embedded **xterm.js** wired to a **local PTY** (via [`portable-pty`](https://crates.io/crates/portable-pty)): Windows starts **PowerShell** (`powershell.exe -NoLogo`); macOS/Linux uses **`$SHELL`** or `/bin/sh`. Output streams on Tauri events `terminal-output` / `terminal-exit`; input uses `terminal_write`. Opening the tab mounts the terminal; leaving it disposes the PTY.

## shadcn/ui

Add components with:

```bash
npx shadcn@latest add <component> -y
```
