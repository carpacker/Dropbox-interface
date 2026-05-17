/**
 * Per-browser view-mode preference (List vs Tile). One value per
 * browser-id so the local FileBrowser and the Dropbox flat browser can
 * each remember their own choice. (Pipelines have their own per-path
 * `view-mode.ts`; this is the global preference for browsers that
 * aren't pipelines.)
 *
 * Storage shape: `Record<browserId, BrowserViewMode>` under
 * `dropbox-interface:browser-view-mode:v1`. Unknown values fall back
 * to "list" so a hand-edited entry can't wedge the UI.
 */

const STORAGE_KEY = "dropbox-interface:browser-view-mode:v1";

export type BrowserViewMode = "list" | "tile";

export const DEFAULT_BROWSER_VIEW_MODE: BrowserViewMode = "list";

const VALID: BrowserViewMode[] = ["list", "tile"];

function isMode(v: unknown): v is BrowserViewMode {
  return typeof v === "string" && (VALID as string[]).includes(v);
}

function readRaw(): Record<string, BrowserViewMode> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, BrowserViewMode> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isMode(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRaw(table: Record<string, BrowserViewMode>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    /* private mode / quota — silently drop */
  }
}

export function getBrowserViewMode(browserId: string): BrowserViewMode {
  return readRaw()[browserId] ?? DEFAULT_BROWSER_VIEW_MODE;
}

export function setBrowserViewMode(
  browserId: string,
  mode: BrowserViewMode,
): void {
  const table = readRaw();
  table[browserId] = mode;
  writeRaw(table);
}

export function clearBrowserViewModes(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
