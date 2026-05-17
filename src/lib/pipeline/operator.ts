/**
 * Mutation seam for the pipeline UI. `PipelineView` composes against
 * this interface so it never imports a concrete backend (Dropbox API,
 * local FS); each backend ships its own operator implementation.
 *
 * Two ops + a path joiner + a listing fetcher are enough to drive
 * Promote, missing-state Create, and lazy bucket loads. Delete is
 * deliberately not on the interface — see THREAT_MODEL §D8e — and
 * stays in the caller's hands (DropboxApp owns the Dropbox delete
 * confirm flow; the local-FS view does not surface delete yet).
 */

import type { PipelineEntry } from "./entry";

export type PipelineOperator = {
  /**
   * Move (or rename) `fromPath` → `toPath`. The implementation is
   * responsible for whatever rules the underlying backend enforces
   * (Dropbox 409s on collisions, local FS errors when the destination
   * exists, etc.). Returns the resulting entry's metadata so the
   * caller can avoid an immediate re-list.
   */
  move(fromPath: string, toPath: string): Promise<PipelineEntry>;

  /** Create a new folder at `path`. */
  createFolder(path: string): Promise<PipelineEntry>;

  /** List the direct children of `parentPath`. */
  listChildren(parentPath: string): Promise<PipelineEntry[]>;

  /**
   * Build a path by appending `child` to `parent`. Implementations
   * differ on separator and root handling (Dropbox `""` ↔ `"/"`,
   * Windows `\` vs POSIX `/`).
   */
  joinPath(parent: string, child: string): string;
};
