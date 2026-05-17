/**
 * Persisted CRM configuration. The CRM app is rooted at a single
 * local folder so all of its content — the CSV and any "pertinent
 * files" sidecars — lives in one place the user can back up or sync.
 *
 *   <root>/contacts.csv     ← contact list (header row + N rows)
 *   <root>/files/<rowKey>/  ← optional per-row attachments
 *
 * `rowKey` is derived from the first CSV column unless an `id` column
 * exists (case-insensitive). Defined in `crm-row-key.ts`.
 *
 * Pure helpers — no React, no Tauri. Persists under
 * `dropbox-interface:crm:v1`.
 */

const STORAGE_KEY = "dropbox-interface:crm:v1";

export type CrmConfig = {
  /** Absolute path to the CRM root folder, or null if unconfigured. */
  rootPath: string | null;
};

export const DEFAULT_CRM_CONFIG: CrmConfig = {
  rootPath: null,
};

function isCrmConfig(v: unknown): v is CrmConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.rootPath === null || typeof o.rootPath === "string"
  );
}

export function loadCrmConfig(): CrmConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_CRM_CONFIG };
    const parsed = JSON.parse(raw);
    if (!isCrmConfig(parsed)) return { ...DEFAULT_CRM_CONFIG };
    // Treat whitespace-only paths as unconfigured so a hand-edited
    // value can't wedge the app at "Loading…" forever.
    if (parsed.rootPath !== null && parsed.rootPath.trim() === "") {
      return { ...DEFAULT_CRM_CONFIG };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_CRM_CONFIG };
  }
}

export function saveCrmConfig(config: CrmConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota — silently drop */
  }
}

export function clearCrmConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Build the absolute path to the CSV. Picks the separator from the
 * root path (Windows-style backslashes if the root uses them; POSIX
 * forward slashes otherwise) so the result matches whatever the OS
 * file picker handed us.
 */
export function csvPathFor(root: string): string {
  const sep = pickSep(root);
  return `${root.replace(/[/\\]+$/, "")}${sep}contacts.csv`;
}

/** Build the absolute path to the files directory for a row key. */
export function filesDirFor(root: string, rowKey: string): string {
  const sep = pickSep(root);
  const trimmedRoot = root.replace(/[/\\]+$/, "");
  return `${trimmedRoot}${sep}files${sep}${rowKey}`;
}

function pickSep(parent: string): "/" | "\\" {
  return /^[A-Za-z]:[\\/]/.test(parent) || parent.includes("\\")
    ? "\\"
    : "/";
}
