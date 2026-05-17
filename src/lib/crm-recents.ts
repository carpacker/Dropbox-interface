/**
 * Most-recently-opened CRM roots, persisted to localStorage. Powers
 * the dashboard's "Recent CRMs" quick-launch card (mirroring
 * `pipeline-recents.ts` for the Dropbox pipeline app).
 *
 * Pinned entries are never evicted, sort ahead of unpinned, and stay
 * MRU within their group.
 *
 * Pure helpers — no React, no Tauri.
 */

const STORAGE_KEY = "dropbox-interface:crm:recents:v1";

/** Max number of *unpinned* entries kept; pinned entries are unbounded. */
export const MAX_UNPINNED_CRM_RECENTS = 5;

export type RecentCrm = {
  /** Absolute path to the CRM root folder. */
  path: string;
  /**
   * Human label. Defaults to the folder basename when the caller
   * doesn't supply one; the UI uses this for the card title.
   */
  name: string;
  /** Unix milliseconds; ties broken by insertion order (MRU first). */
  visitedAt: number;
  /** True when the user has explicitly pinned this entry. */
  pinned?: boolean;
};

function isRecentCrm(v: unknown): v is RecentCrm {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.path === "string" &&
    o.path.length > 0 &&
    typeof o.name === "string" &&
    typeof o.visitedAt === "number" &&
    Number.isFinite(o.visitedAt) &&
    (o.pinned === undefined || typeof o.pinned === "boolean")
  );
}

function readRaw(): RecentCrm[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecentCrm);
  } catch {
    return [];
  }
}

function writeRaw(entries: RecentCrm[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Pin-first, then MRU. */
function sorted(entries: RecentCrm[]): RecentCrm[] {
  return [...entries].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.visitedAt - a.visitedAt;
  });
}

export function getRecentCrms(): RecentCrm[] {
  return sorted(readRaw());
}

/**
 * Add (or move-to-front) a CRM root. Deduplicated by path. Pinned
 * status is preserved across visits. Older *unpinned* entries beyond
 * `MAX_UNPINNED_CRM_RECENTS` are dropped; pinned entries are never
 * evicted. `now` is injectable so tests don't have to mock `Date.now`.
 */
export function addRecentCrm(
  entry: { path: string; name: string },
  now: () => number = Date.now,
): void {
  if (entry.path.trim() === "") return;
  const existing = readRaw();
  const previous = existing.find((e) => e.path === entry.path);
  const filtered = existing.filter((e) => e.path !== entry.path);
  const updated: RecentCrm = {
    path: entry.path,
    name: entry.name,
    visitedAt: now(),
    ...(previous?.pinned ? { pinned: true } : {}),
  };
  writeRaw(capped([updated, ...filtered]));
}

/**
 * Toggle pinned status for an existing recent. No-ops when the path
 * isn't present yet (users can only pin from rows already in the
 * list).
 */
export function setCrmPinned(path: string, pinned: boolean): void {
  const existing = readRaw();
  const idx = existing.findIndex((e) => e.path === path);
  if (idx < 0) return;
  const updated = { ...existing[idx], pinned: pinned || undefined };
  if (!pinned) delete updated.pinned;
  const next = [...existing];
  next[idx] = updated;
  writeRaw(capped(next));
}

function capped(entries: RecentCrm[]): RecentCrm[] {
  const pinned = entries.filter((e) => e.pinned);
  const unpinnedMru = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_UNPINNED_CRM_RECENTS);
  return [...pinned, ...unpinnedMru];
}

export function clearRecentCrms(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Derive a friendly label from a root path: take the last non-empty
 * path component. Defensive against trailing separators.
 */
export function deriveCrmName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || "CRM";
}
