import { invoke } from "@tauri-apps/api/core";

/**
 * Dropbox app key, sourced from build-time env. Register your Dropbox app at
 * https://www.dropbox.com/developers/apps and put its **App key** in
 * `.env.local` (or `.env`) as `VITE_DROPBOX_APP_KEY=...`. PKCE uses no
 * secret, so the key is safe to ship in the bundle.
 *
 * Read lazily so tests can flip the env via `vi.stubEnv` between cases.
 */
export function dropboxAppKey(): string {
  return (
    (import.meta.env.VITE_DROPBOX_APP_KEY as string | undefined)?.trim() ?? ""
  );
}

export type DropboxAccount = {
  accountId: string;
  displayName: string;
  email: string;
};

export type DropboxEntry = {
  kind: "file" | "folder";
  name: string;
  path: string;
  displayPath: string;
  size: number | null;
  serverModified: string | null;
};

export function dropboxIsConfigured(): boolean {
  return dropboxAppKey().length > 0;
}

export function dropboxStatus() {
  return invoke<DropboxAccount | null>("dropbox_status", {
    appKey: dropboxAppKey(),
  });
}

export function dropboxConnect() {
  return invoke<DropboxAccount>("dropbox_connect", {
    appKey: dropboxAppKey(),
  });
}

export function dropboxDisconnect() {
  return invoke<void>("dropbox_disconnect", { appKey: dropboxAppKey() });
}

export function dropboxListFolder(path: string) {
  return invoke<DropboxEntry[]>("dropbox_list_folder", {
    appKey: dropboxAppKey(),
    path,
  });
}

/**
 * Pure helper: given a Dropbox-style path (e.g. "/Photos/2024"), return its
 * parent. Empty input or root returns null.
 */
export function dropboxParent(path: string): string | null {
  if (!path || path === "/") {
    return null;
  }
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx < 0) {
    return null;
  }
  if (idx === 0) {
    return "";
  }
  return trimmed.slice(0, idx);
}
