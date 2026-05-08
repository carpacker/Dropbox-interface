/**
 * Per-item review notes, persisted to localStorage. Local-only by
 * deliberate scope choice (see THREAT_MODEL §D8b — we don't request
 * `files.content.write`, so notes can't round-trip through Dropbox
 * yet). Keyed by the Dropbox `path_lower` so the lookup matches
 * Dropbox's own case-insensitive identity.
 *
 * Pure helpers — no React, no Tauri.
 */

const STORAGE_KEY = "dropbox-interface:pipeline-notes";

export type Note = {
  /** Free-form text the user typed. Trimmed but not otherwise sanitized. */
  body: string;
  /** Unix milliseconds of the last save. */
  updatedAt: number;
};

/** All notes, keyed by lowercase Dropbox path. */
export type NotesByPath = Record<string, Note>;

function isNote(v: unknown): v is Note {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.body === "string" &&
    typeof o.updatedAt === "number" &&
    Number.isFinite(o.updatedAt)
  );
}

function readAll(): NotesByPath {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: NotesByPath = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && k.length > 0 && isNote(v)) {
        out[k] = v;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeAll(notes: NotesByPath): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch {
    /* private mode / quota — silently drop */
  }
}

/** Read a single note by Dropbox path. Returns null when absent. */
export function getNote(path: string): Note | null {
  const all = readAll();
  return all[path] ?? null;
}

/**
 * Write a note for `path`. An empty/whitespace-only body deletes the
 * entry entirely, so toggling Save with an empty textarea is the
 * delete affordance.
 *
 * `now` is injectable so tests don't have to mock `Date.now`.
 */
export function setNote(
  path: string,
  body: string,
  now: () => number = Date.now,
): void {
  const trimmed = body.trim();
  const all = readAll();
  if (trimmed === "") {
    if (path in all) {
      delete all[path];
      writeAll(all);
    }
    return;
  }
  all[path] = { body: trimmed, updatedAt: now() };
  writeAll(all);
}

/** Wipe a single note. */
export function deleteNote(path: string): void {
  const all = readAll();
  if (!(path in all)) return;
  delete all[path];
  writeAll(all);
}

/**
 * Read every note. Used by the pipeline view to know which rows
 * should display the "has note" indicator dot in O(1) per row.
 */
export function getAllNotes(): NotesByPath {
  return readAll();
}

/** Wipe every note. Used by tests; no UI surfaces this yet. */
export function clearAllNotes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
