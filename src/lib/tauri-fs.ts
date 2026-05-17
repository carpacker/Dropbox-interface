import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  /** Size in bytes; null for directories or platforms without metadata. */
  size: number | null;
  /** Last-modified time as unix *seconds*; null when unavailable. */
  modified: number | null;
};

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
] as const;

export function isImageFile(path: string): boolean {
  const lowered = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

export function defaultLocalRoot() {
  return invoke<string>("default_local_root");
}

export function parentDirectory(path: string) {
  return invoke<string | null>("parent_directory", { path });
}

export function listDirectory(path: string) {
  return invoke<FsEntry[]>("list_directory", { path });
}

/**
 * Convert a local filesystem path into a URL the webview can load via the
 * Tauri asset protocol. Streams the file directly into <img>/<video>/etc
 * without round-tripping through JS memory like a base64 data URL would.
 */
export function imageSrc(path: string): string {
  return convertFileSrc(path);
}

/**
 * Read a small text file (e.g. `.dropbox-interface.json`) from local
 * disk. Returns the file contents, or `null` when the file does not
 * exist. Capped at 256KB by default; pass `maxBytes` to override. Used
 * by `LocalPipelineSource` to discover pipeline configs.
 */
export function readTextFile(path: string, maxBytes?: number) {
  return invoke<string | null>("local_read_text_file", { path, maxBytes });
}

/**
 * Move (or rename) a local file/folder. Used by Promote on local-FS
 * pipelines. The destination's parent must already exist; the
 * destination itself must not. Returns metadata for the resulting
 * entry so callers can update listings without re-fetching.
 */
export function moveItem(fromPath: string, toPath: string) {
  return invoke<FsEntry>("local_move", { fromPath, toPath });
}

/**
 * Create a new local directory. Parent must exist; path must not.
 * Used by the "create missing state folder" affordance when a local
 * pipeline declares a state whose folder isn't present yet.
 */
export function createFolder(path: string) {
  return invoke<FsEntry>("local_create_folder", { path });
}

/**
 * Atomically write a UTF-8 text file. The Rust side writes to
 * `<dir>/.<basename>.tmp` then renames over the destination, so a
 * crash mid-write leaves the original intact. Used by the CRM to
 * persist `contacts.csv` after an add/edit/delete. Capped at 16MB.
 */
export function writeTextFile(path: string, contents: string) {
  return invoke<FsEntry>("local_write_text_file", { path, contents });
}

/**
 * Copy a file. Refuses to overwrite an existing destination; source
 * must be a file (not a directory). Used by the CRM "Attach file"
 * affordance to drop a user-chosen file into the row's sidecar.
 */
export function copyFile(fromPath: string, toPath: string) {
  return invoke<FsEntry>("local_copy_file", { fromPath, toPath });
}
