/**
 * Most-recently-visited Dropbox pipeline folders, persisted to
 * localStorage. The dashboard reads this to surface quick-launch
 * buttons; `DropboxApp` writes to it whenever a valid
 * `.dropbox-interface.json` config loads.
 *
 * Two flavors of entry coexist in the same list:
 *
 *  - **Unpinned (regular):** subject to `MAX_UNPINNED_RECENTS` cap;
 *    LRU eviction.
 *  - **Pinned:** never evicted, sorted ahead of unpinned, MRU within
 *    the pinned section. Toggle with `setPinned(path, true|false)`.
 *
 * Pure helpers — no React, no Tauri. Tests run against vitest's
 * jsdom-backed localStorage.
 */

const STORAGE_KEY = "dropbox-interface:recent-pipelines";

/** Max number of *unpinned* entries kept; pinned entries are unbounded. */
export const MAX_UNPINNED_RECENTS = 5;

/** Legacy export name retained for callers that haven't migrated yet. */
export const MAX_RECENT_PIPELINES = MAX_UNPINNED_RECENTS;

export type RecentPipeline = {
  /** Dropbox path of the pipeline parent folder. "" means root. */
  path: string;
  /** Display label; usually the config's `name`, falling back to the path. */
  name: string;
  /** Unix milliseconds; ties broken by insertion order (MRU first). */
  visitedAt: number;
  /** True when the user has explicitly pinned this entry. */
  pinned?: boolean;
};

function isRecentPipeline(v: unknown): v is RecentPipeline {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    typeof o.name === "string" &&
    typeof o.visitedAt === "number" &&
    Number.isFinite(o.visitedAt) &&
    (o.pinned === undefined || typeof o.pinned === "boolean")
  );
}

function readRaw(): RecentPipeline[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentPipeline);
  } catch {
    return [];
  }
}

function writeRaw(entries: RecentPipeline[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Pin-first, then MRU. Stable across calls for the same input. */
function sorted(entries: RecentPipeline[]): RecentPipeline[] {
  return [...entries].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.visitedAt - a.visitedAt;
  });
}

/**
 * Read the recents list. Pinned entries are sorted to the front; both
 * sections are MRU within. Returns `[]` for malformed storage,
 * non-localStorage environments, or any thrown error.
 */
export function getRecentPipelines(): RecentPipeline[] {
  return sorted(readRaw());
}

/**
 * Add (or move-to-front) a pipeline. Deduplicated by path. Pinned
 * status is preserved across visits. Older *unpinned* entries beyond
 * `MAX_UNPINNED_RECENTS` are dropped; pinned entries are never
 * evicted.
 *
 * `now` is injectable so tests don't have to mock `Date.now`.
 */
export function addRecentPipeline(
  entry: { path: string; name: string },
  now: () => number = Date.now,
): void {
  const existing = readRaw();
  const previous = existing.find((e) => e.path === entry.path);
  const filtered = existing.filter((e) => e.path !== entry.path);
  const updated: RecentPipeline = {
    path: entry.path,
    name: entry.name,
    visitedAt: now(),
    ...(previous?.pinned ? { pinned: true } : {}),
  };
  writeRaw(capped([updated, ...filtered]));
}

/**
 * Toggle pinned status for an existing recent. No-ops when the path
 * isn't present in the list yet (pin from the dashboard or from
 * inside the pipeline view, both of which only show paths that have
 * already been visited).
 */
export function setPinned(path: string, pinned: boolean): void {
  const existing = readRaw();
  const idx = existing.findIndex((e) => e.path === path);
  if (idx < 0) return;
  const updated = { ...existing[idx], pinned: pinned || undefined };
  if (!pinned) delete updated.pinned;
  const next = [...existing];
  next[idx] = updated;
  writeRaw(capped(next));
}

/**
 * Cap only the unpinned section, keeping pinned entries unbounded.
 * The unpinned slice is taken **after** sorting by visitedAt-desc so
 * that "drop oldest" is correct regardless of how the input array was
 * built (e.g. setPinned doesn't reorder).
 */
function capped(entries: RecentPipeline[]): RecentPipeline[] {
  const pinned = entries.filter((e) => e.pinned);
  const unpinnedMru = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_UNPINNED_RECENTS);
  return [...pinned, ...unpinnedMru];
}

/** Wipe the list. Used by tests; no UI surfaces this yet. */
export function clearRecentPipelines(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
