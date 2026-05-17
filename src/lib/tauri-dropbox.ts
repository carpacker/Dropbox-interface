import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { isImageFile } from "./tauri-fs";

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

/** Documented Dropbox thumbnail size tokens. */
export type DropboxThumbnailSize =
  | "w64h64"
  | "w128h128"
  | "w256h256"
  | "w480h320"
  | "w640h480"
  | "w960h640"
  | "w1024h768"
  | "w2048h1536";

/** Returns a `data:image/jpeg;base64,…` URL ready to drop into `<img src>`. */
export function dropboxGetThumbnail(path: string, size: DropboxThumbnailSize) {
  return invoke<string>("dropbox_get_thumbnail", {
    appKey: dropboxAppKey(),
    path,
    size,
  });
}

/**
 * Stream a Dropbox file into a local temp file and return its absolute path.
 * Caller is expected to feed it into `convertFileSrc` for `<img>`/`<video>`.
 */
export function dropboxDownloadToTemp(path: string) {
  return invoke<string>("dropbox_download_to_temp", {
    appKey: dropboxAppKey(),
    path,
  });
}

/** Stream a Dropbox file directly to a user-chosen destination path. */
export function dropboxSaveFileTo(path: string, dest: string) {
  return invoke<number>("dropbox_save_file_to", {
    appKey: dropboxAppKey(),
    path,
    dest,
  });
}

/**
 * Read a small text file (e.g. a pipeline config) from Dropbox. Returns
 * the file contents, or `null` when the path does not exist. Capped at
 * 256KB by default; pass `maxBytes` to override.
 */
export function dropboxReadTextFile(path: string, maxBytes?: number) {
  return invoke<string | null>("dropbox_read_text_file", {
    appKey: dropboxAppKey(),
    path,
    maxBytes,
  });
}

/**
 * Move (or rename) a file or folder. Returns the resulting entry's
 * metadata. Used by the Promote action to shift an item from one state
 * folder to its successor; failures (e.g. destination already exists,
 * source not found, missing scope) come back as exceptions.
 */
export function dropboxMove(fromPath: string, toPath: string) {
  return invoke<DropboxEntry>("dropbox_move_v2", {
    appKey: dropboxAppKey(),
    fromPath,
    toPath,
  });
}

/**
 * Create a new folder. Used by the "create missing state folder"
 * affordance in the pipeline view. Returns the new folder's metadata.
 */
export function dropboxCreateFolder(path: string) {
  return invoke<DropboxEntry>("dropbox_create_folder_v2", {
    appKey: dropboxAppKey(),
    path,
  });
}

/**
 * Delete a single file or folder via /files/delete_v2. Callers MUST
 * gate this behind a confirmation modal. Dropbox keeps the deleted
 * item in trash for 30 days; restoring is a manual step on
 * dropbox.com.
 */
export function dropboxDelete(path: string) {
  return invoke<DropboxEntry>("dropbox_delete_v2", {
    appKey: dropboxAppKey(),
    path,
  });
}

/** Wrap a temp/preview path so it can be used as an `<img src>`. */
export function dropboxLocalSrc(localPath: string): string {
  return convertFileSrc(localPath);
}

/**
 * Adapter so the generic `sortEntries` helper (in `lib/sort.ts`) can
 * read DropboxEntry shapes — DropboxEntry uses `kind` + `serverModified`
 * where SortableEntry expects `isDirectory` + `modified`.
 */
export function dropboxEntryToSortable(entry: DropboxEntry) {
  return {
    name: entry.name,
    size: entry.size,
    modified: entry.serverModified,
    isDirectory: entry.kind === "folder",
  };
}

export function isDropboxImage(entry: DropboxEntry): boolean {
  if (entry.kind !== "file") {
    return false;
  }
  // Reuses the same extension list the local Photos app uses, imported
  // lazily to keep this module's dependency graph local-FS-aware
  // without bloating it.
  return isImageFile(entry.name);
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
