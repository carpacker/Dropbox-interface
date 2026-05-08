/**
 * Sort preferences for file listings, persisted globally to
 * `localStorage`. Pure helpers — no React, no Tauri. Same shape used by
 * the local file browser, the Dropbox flat browser, the pipeline
 * buckets, and the Photos grid so a user's "newest first" choice
 * carries across surfaces.
 *
 * `name` always works. `modified` and `size` work whenever the
 * underlying entry exposes those fields; entries that don't expose
 * them sort to the end (alphabetically among themselves) so empty
 * metadata never clobbers a list.
 */

const STORAGE_KEY = "dropbox-interface:sort-preference-v1";

export type SortKey = "name" | "modified" | "size";
export type SortDirection = "asc" | "desc";

export type SortPreference = {
  key: SortKey;
  direction: SortDirection;
};

export const DEFAULT_SORT: SortPreference = {
  key: "name",
  direction: "asc",
};

/**
 * Minimum surface every sortable entry must satisfy. Concrete types
 * (`FsEntry`, `DropboxEntry`) are widened to this on the way into the
 * sort helpers.
 */
export type SortableEntry = {
  name: string;
  /** Bytes; null/undefined for folders or unknown. */
  size?: number | null;
  /**
   * Either an ISO-8601 string (Dropbox's `server_modified`) or unix
   * seconds (the local FS path). Both are accepted; helpers convert.
   */
  modified?: string | number | null;
  /** When true, sorted ahead of files in mixed listings. */
  isDirectory?: boolean;
};

function isValidKey(v: unknown): v is SortKey {
  return v === "name" || v === "modified" || v === "size";
}
function isValidDir(v: unknown): v is SortDirection {
  return v === "asc" || v === "desc";
}

export function loadSortPreference(): SortPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SORT;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return DEFAULT_SORT;
    const o = parsed as Record<string, unknown>;
    if (!isValidKey(o.key) || !isValidDir(o.direction)) return DEFAULT_SORT;
    return { key: o.key, direction: o.direction };
  } catch {
    return DEFAULT_SORT;
  }
}

export function saveSortPreference(pref: SortPreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    /* private mode / quota */
  }
}

export function clearSortPreference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Coerce a `modified` field (string or number) to comparable seconds. */
function modifiedToSeconds(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // string: ISO-8601
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

/**
 * Return a NEW sorted array. Stable: ties (and entries missing the
 * sort field) fall back to case-insensitive name comparison.
 *
 * `keepFoldersFirst` (default true) sorts directory-style entries
 * ahead of files regardless of the chosen key, matching the local
 * file browser's existing convention.
 *
 * `toSortable` lets callers sort heterogeneous entry shapes (e.g.
 * `DropboxEntry` whose modified field is `serverModified` and whose
 * directory flag is `kind === "folder"`) without first remapping the
 * array. When omitted, the entry IS the `SortableEntry`.
 */
export function sortEntries<T>(
  entries: ReadonlyArray<T>,
  pref: SortPreference,
  options: {
    keepFoldersFirst?: boolean;
    toSortable?: (entry: T) => SortableEntry;
  } = {},
): T[] {
  const { keepFoldersFirst = true, toSortable } = options;
  const factor = pref.direction === "asc" ? 1 : -1;
  const view: (entry: T) => SortableEntry =
    toSortable ?? ((entry) => entry as unknown as SortableEntry);

  // We index the original positions so the sort is stable when
  // there's no preference signal (fallback name compare also missing).
  const indexed = entries.map((e, i) => ({ e, key: view(e), i }));
  indexed.sort((a, b) => {
    if (keepFoldersFirst) {
      const ad = a.key.isDirectory ? 1 : 0;
      const bd = b.key.isDirectory ? 1 : 0;
      if (ad !== bd) return bd - ad;
    }

    if (pref.key === "modified") {
      const am = modifiedToSeconds(a.key.modified);
      const bm = modifiedToSeconds(b.key.modified);
      if (am === null && bm === null) {
        // both missing — fall through to name
      } else if (am === null) {
        return 1; // unknowns to the end
      } else if (bm === null) {
        return -1;
      } else if (am !== bm) {
        return (am - bm) * factor;
      }
    }

    if (pref.key === "size") {
      const as = a.key.size ?? null;
      const bs = b.key.size ?? null;
      if (as === null && bs === null) {
        // fall through
      } else if (as === null) {
        return 1;
      } else if (bs === null) {
        return -1;
      } else if (as !== bs) {
        return (as - bs) * factor;
      }
    }

    // name (or fallback). Always ascending for fallback comparisons so
    // descending sorts of other fields don't make name tiebreaks
    // surprising; the leading factor only applies to the chosen key.
    const an = a.key.name.toLowerCase();
    const bn = b.key.name.toLowerCase();
    if (an !== bn) {
      const cmp = an < bn ? -1 : 1;
      // For the "name" key, apply factor; for fallbacks, stay asc.
      return pref.key === "name" ? cmp * factor : cmp;
    }
    return a.i - b.i; // stable
  });
  return indexed.map(({ e }) => e);
}

/** Human-friendly byte count: "1.2 MB", "245 KB", "12 B". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
    return "";
  }
  if (bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}
