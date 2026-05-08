/**
 * Pure helpers that operate on a parsed `PipelineConfig` plus an entry
 * listing. No I/O. Backend-agnostic — works against any object shaped like
 * `EntryHandle`.
 */

import type { PipelineConfig, PipelineState } from "./schema";

/**
 * Backend-agnostic file/folder handle. The `path` value is opaque to the
 * pipeline lib; it's whatever the source uses internally (Dropbox path,
 * absolute local path, etc).
 */
export type EntryHandle = {
  name: string;
  path: string;
  isDirectory: boolean;
};

/** Filename of the in-tree pipeline declaration. */
export const CONFIG_FILENAME = ".dropbox-interface.json";

/**
 * Look up a state in the pipeline by its slug id. Returns null if the id
 * is unknown.
 */
export function findState(
  config: PipelineConfig,
  stateId: string,
): PipelineState | null {
  return config.states.find((s) => s.id === stateId) ?? null;
}

/**
 * The next state in pipeline order, or null when there is none.
 *
 * Returns null when:
 *   - the current id is unknown
 *   - the current state is the last entry in `states`
 *   - the current state has `terminal: true`
 *
 * Tests treat the absence of a successor and a terminal flag as
 * equivalent for callers that only care "can I promote?".
 */
export function nextState(
  config: PipelineConfig,
  currentId: string,
): PipelineState | null {
  const idx = config.states.findIndex((s) => s.id === currentId);
  if (idx < 0) return null;
  const current = config.states[idx];
  if (current.terminal) return null;
  return config.states[idx + 1] ?? null;
}

/**
 * The classification of a parent folder's direct children for a pipeline
 * view. Computed in one pass so callers can render the bucket strip + the
 * inbox without extra grouping logic.
 */
export type Classification = {
  /** State id → the folder entry that backs that state, when present. */
  stateFolders: Record<string, EntryHandle>;
  /**
   * Items that are direct children of the parent and *aren't* state
   * folders or the config file — typically loose drops the user hasn't
   * placed yet.
   */
  inbox: EntryHandle[];
  /**
   * States declared in the config whose `folder` was not found in the
   * listing. The UI surfaces these as warnings rather than swallowing
   * them silently.
   */
  missing: PipelineState[];
};

/**
 * Group a parent folder's listing by pipeline state.
 *
 * Inputs are intentionally minimal — pass the literal listing returned by
 * the source for the parent folder. The function does not list state
 * folders; the caller does that separately because each one is its own
 * API call.
 */
export function classifyParentListing(
  entries: EntryHandle[],
  config: PipelineConfig,
): Classification {
  const folderToState = new Map<string, PipelineState>();
  for (const state of config.states) {
    folderToState.set(state.folder, state);
  }

  const stateFolders: Record<string, EntryHandle> = {};
  const inbox: EntryHandle[] = [];

  for (const entry of entries) {
    if (entry.name === CONFIG_FILENAME) {
      continue;
    }
    const state = entry.isDirectory ? folderToState.get(entry.name) : undefined;
    if (state) {
      stateFolders[state.id] = entry;
    } else {
      inbox.push(entry);
    }
  }

  const missing = config.states.filter((s) => !(s.id in stateFolders));

  return { stateFolders, inbox, missing };
}

/**
 * Convenience: total count of items in the parent that the pipeline view
 * will render across all buckets *excluding* the state folders themselves.
 * State-folder contents come from per-state listings; this helper is for
 * the "Inbox: N items" badge in the strip.
 */
export function inboxCount(classification: Classification): number {
  return classification.inbox.length;
}
