/**
 * Most-recently-visited Dropbox pipeline folders, persisted to
 * localStorage. The dashboard reads this to surface quick-launch
 * buttons; `DropboxApp` writes to it whenever a valid
 * `.dropbox-interface.json` config loads.
 *
 * Pure helpers — no React, no Tauri. Tests run against vitest's
 * jsdom-backed localStorage.
 */

const STORAGE_KEY = "dropbox-interface:recent-pipelines";
export const MAX_RECENT_PIPELINES = 5;

export type RecentPipeline = {
  /** Dropbox path of the pipeline parent folder. "" means root. */
  path: string;
  /** Display label; usually the config's `name`, falling back to the path. */
  name: string;
  /** Unix milliseconds; ties broken by insertion order (MRU first). */
  visitedAt: number;
};

function isRecentPipeline(v: unknown): v is RecentPipeline {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    typeof o.name === "string" &&
    typeof o.visitedAt === "number" &&
    Number.isFinite(o.visitedAt)
  );
}

/**
 * Read the recents list. Returns `[]` for malformed storage,
 * non-localStorage environments, or any thrown error.
 */
export function getRecentPipelines(): RecentPipeline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isRecentPipeline)
      .slice(0, MAX_RECENT_PIPELINES);
  } catch {
    return [];
  }
}

/**
 * Add (or move-to-front) a pipeline. Deduplicated by path; older
 * entries beyond `MAX_RECENT_PIPELINES` are dropped.
 *
 * `now` is injectable so tests don't have to mock `Date.now`.
 */
export function addRecentPipeline(
  entry: { path: string; name: string },
  now: () => number = Date.now,
): void {
  try {
    const existing = getRecentPipelines().filter((e) => e.path !== entry.path);
    const updated: RecentPipeline[] = [
      { path: entry.path, name: entry.name, visitedAt: now() },
      ...existing,
    ].slice(0, MAX_RECENT_PIPELINES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Wipe the list. Used by tests; no UI surfaces this yet. */
export function clearRecentPipelines(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
