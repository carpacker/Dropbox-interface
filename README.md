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
- **Terminal** tab: embedded **xterm.js** + **`portable-pty`**. Shell profile is selectable (Windows: PowerShell, Command Prompt, `pwsh`; macOS/Linux: login **`$SHELL`**, `/bin/sh`, `/bin/bash`) and stored under **`localStorage`** key `dropbox-interface:terminal-shell`. After you open Terminal once, the tab panel stays mounted so the **PTY session survives** switching to Files. `terminal_spawn` takes a **`shell`** id plus **`cols`** / **`rows`**; streams use **`terminal-output`** / **`terminal-exit`** events and **`terminal_write`** for input.

## shadcn/ui

Add components with:

```bash
npx shadcn@latest add <component> -y
```
