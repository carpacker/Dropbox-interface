/**
 * Persisted Job Tracker configuration. Mirrors `crm-config.ts` —
 * one root folder per Job Tracker instance, holding everything in
 * one place the user can back up, sync, or share with the team:
 *
 *   <root>/jobs.csv               ← job rows
 *   <root>/files/<rowKey>/        ← per-job attachments
 *   <root>/threads/<rowKey>.jsonl ← per-job activity log (read-only v1)
 *
 * `rowKey` comes from the existing `crm-row-key.ts` helpers (id →
 * name → first column, sanitized for filesystem safety).
 *
 * Pure helpers — no React, no Tauri. Persists under
 * `dropbox-interface:job-tracker:v1`.
 */

const STORAGE_KEY = "dropbox-interface:job-tracker:v1";

export type JobTrackerConfig = {
  /** Absolute path to the Job Tracker root, or null if unconfigured. */
  rootPath: string | null;
};

export const DEFAULT_JOB_TRACKER_CONFIG: JobTrackerConfig = {
  rootPath: null,
};

function isJobTrackerConfig(v: unknown): v is JobTrackerConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.rootPath === null || typeof o.rootPath === "string";
}

export function loadJobTrackerConfig(): JobTrackerConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_JOB_TRACKER_CONFIG };
    const parsed = JSON.parse(raw);
    if (!isJobTrackerConfig(parsed)) {
      return { ...DEFAULT_JOB_TRACKER_CONFIG };
    }
    // Whitespace-only paths → treat as unconfigured so a hand-edited
    // value can't wedge the app at "Loading…" forever (same defense
    // as crm-config).
    if (parsed.rootPath !== null && parsed.rootPath.trim() === "") {
      return { ...DEFAULT_JOB_TRACKER_CONFIG };
    }
    return parsed;
  } catch {
    return { ...DEFAULT_JOB_TRACKER_CONFIG };
  }
}

export function saveJobTrackerConfig(config: JobTrackerConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* private mode / quota — silently drop */
  }
}

export function clearJobTrackerConfig(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Path helpers. Pick the separator from the root style so the result
 * matches whatever the OS file picker handed us (Windows `\`, POSIX
 * `/`).
 */
function pickSep(parent: string): "/" | "\\" {
  return /^[A-Za-z]:[\\/]/.test(parent) || parent.includes("\\")
    ? "\\"
    : "/";
}

function trimTrailing(p: string): string {
  return p.replace(/[/\\]+$/, "");
}

export function jobsCsvPathFor(root: string): string {
  const sep = pickSep(root);
  return `${trimTrailing(root)}${sep}jobs.csv`;
}

export function jobFilesDirFor(root: string, rowKey: string): string {
  const sep = pickSep(root);
  return `${trimTrailing(root)}${sep}files${sep}${rowKey}`;
}

export function jobThreadPathFor(root: string, rowKey: string): string {
  const sep = pickSep(root);
  return `${trimTrailing(root)}${sep}threads${sep}${rowKey}.jsonl`;
}
