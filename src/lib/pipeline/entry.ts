/**
 * Backend-neutral entry shape used by `PipelineView`. The fields exactly
 * match `DropboxEntry` (in `src/lib/tauri-dropbox.ts`) so a value of that
 * type passes through structurally — no adapter needed on the Dropbox
 * side. The local-FS adapter (`fsEntryToPipelineEntry`) converts an
 * `FsEntry` into this shape so the same renderer can host either
 * backend.
 *
 * The leaky `serverModified` name is preserved for source-compat with
 * the in-tree DropboxEntry users; a future rename round can swap it to
 * something backend-neutral once the callers settle.
 */

import type { FsEntry } from "@/lib/tauri-fs";

export type PipelineEntry = {
  kind: "file" | "folder";
  name: string;
  path: string;
  /** Display string for paths shown to the user (Dropbox preserves case). */
  displayPath: string;
  /** Bytes; null for folders or platforms without metadata. */
  size: number | null;
  /** ISO 8601 timestamp; null when not known. */
  serverModified: string | null;
};

/**
 * Convert a local-FS entry into a `PipelineEntry`. Maps the unix-seconds
 * `modified` field into an ISO 8601 string so the renderer can format
 * "Modified" the same way it does for Dropbox entries.
 */
export function fsEntryToPipelineEntry(e: FsEntry): PipelineEntry {
  return {
    kind: e.isDirectory ? "folder" : "file",
    name: e.name,
    path: e.path,
    displayPath: e.path,
    size: e.size,
    serverModified:
      e.modified != null ? new Date(e.modified * 1000).toISOString() : null,
  };
}
