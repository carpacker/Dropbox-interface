/**
 * Per-pipeline view-mode preference: list (default) or gallery. Persisted
 * per parent path so an image-heavy pipeline can stay in gallery while a
 * doc-heavy one stays in list. Pure helpers — no React, no Tauri.
 *
 * Storage shape: `Record<parentPath, ViewMode>` under
 * `dropbox-interface:pipeline-view-mode:v1`. Unknown values fall back to
 * "list" so a config-file rename or hand-edit can't wedge the UI.
 */

const STORAGE_KEY = "dropbox-interface:pipeline-view-mode:v1";

export type ViewMode = "list" | "gallery";

export const DEFAULT_VIEW_MODE: ViewMode = "list";

const VALID_MODES: ViewMode[] = ["list", "gallery"];

function isViewMode(v: unknown): v is ViewMode {
  return typeof v === "string" && (VALID_MODES as string[]).includes(v);
}

function readRaw(): Record<string, ViewMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, ViewMode> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isViewMode(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRaw(table: Record<string, ViewMode>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Returns the stored mode for `parentPath`, or the default when absent. */
export function getViewMode(parentPath: string): ViewMode {
  return readRaw()[parentPath] ?? DEFAULT_VIEW_MODE;
}

/**
 * Persist `mode` for `parentPath`. Setting the default is stored
 * explicitly (rather than removing the key) so a deliberate "go back to
 * list" sticks even if defaults change later.
 */
export function setViewMode(parentPath: string, mode: ViewMode): void {
  const table = readRaw();
  table[parentPath] = mode;
  writeRaw(table);
}

/** Wipe the table. Used by tests; no UI surfaces this. */
export function clearViewModes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
