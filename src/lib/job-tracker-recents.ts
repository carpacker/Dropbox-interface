/**
 * Most-recently-opened Job Tracker roots, persisted to localStorage.
 * Powers the dashboard's "Recent Job Trackers" quick-launch card.
 *
 * Mirrors the shape of `crm-recents.ts` and `pipeline-recents.ts`:
 * pinned first, MRU within group, unpinned cap. The two CRM/Job
 * helpers share enough structure that a future round could factor
 * them into a generic `lib/recents.ts<T>`. Deferred until a third
 * recents bucket lands and the shape settles.
 */

const STORAGE_KEY = "dropbox-interface:job-tracker:recents:v1";

export const MAX_UNPINNED_JOB_RECENTS = 5;

export type RecentJobTracker = {
  /** Absolute path to the Job Tracker root folder. */
  path: string;
  /** Display label; defaults to the folder basename. */
  name: string;
  /** Unix milliseconds; ties broken by insertion order (MRU first). */
  visitedAt: number;
  /** True when the user has explicitly pinned this entry. */
  pinned?: boolean;
};

function isRecent(v: unknown): v is RecentJobTracker {
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

function readRaw(): RecentJobTracker[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecent);
  } catch {
    return [];
  }
}

function writeRaw(entries: RecentJobTracker[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Pin-first, then MRU. */
function sorted(entries: RecentJobTracker[]): RecentJobTracker[] {
  return [...entries].sort((a, b) => {
    const ap = a.pinned ? 1 : 0;
    const bp = b.pinned ? 1 : 0;
    if (ap !== bp) return bp - ap;
    return b.visitedAt - a.visitedAt;
  });
}

export function getRecentJobTrackers(): RecentJobTracker[] {
  return sorted(readRaw());
}

export function addRecentJobTracker(
  entry: { path: string; name: string },
  now: () => number = Date.now,
): void {
  if (entry.path.trim() === "") return;
  const existing = readRaw();
  const previous = existing.find((e) => e.path === entry.path);
  const filtered = existing.filter((e) => e.path !== entry.path);
  const updated: RecentJobTracker = {
    path: entry.path,
    name: entry.name,
    visitedAt: now(),
    ...(previous?.pinned ? { pinned: true } : {}),
  };
  writeRaw(capped([updated, ...filtered]));
}

export function setJobTrackerPinned(path: string, pinned: boolean): void {
  const existing = readRaw();
  const idx = existing.findIndex((e) => e.path === path);
  if (idx < 0) return;
  const updated = { ...existing[idx], pinned: pinned || undefined };
  if (!pinned) delete updated.pinned;
  const next = [...existing];
  next[idx] = updated;
  writeRaw(capped(next));
}

function capped(entries: RecentJobTracker[]): RecentJobTracker[] {
  const pinned = entries.filter((e) => e.pinned);
  const unpinnedMru = entries
    .filter((e) => !e.pinned)
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, MAX_UNPINNED_JOB_RECENTS);
  return [...pinned, ...unpinnedMru];
}

export function clearRecentJobTrackers(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Derive a friendly label from a root path (last path component). */
export function deriveJobTrackerName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  return parts[parts.length - 1] || trimmed || "Job Tracker";
}
