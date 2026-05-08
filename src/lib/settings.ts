/**
 * App-wide settings: theme + dashboard layout. Persisted globally to
 * `localStorage` and applied via tiny CSS-class toggles (no styled
 * runtime, no context provider). Pure helpers — no React, no Tauri.
 *
 * Theme:
 *   - "light" → ensures `html.dark` is OFF
 *   - "dark"  → ensures `html.dark` is ON
 *   - "system" (default) → mirrors the OS preference and stays in sync
 *     across changes via `matchMedia`
 *
 * Dashboard layout:
 *   - "stacked"  → 1 column, full-width cards
 *   - "grid"     → auto-fit responsive grid (default; previous behavior)
 *   - "compact"  → tighter 4+ column grid
 *
 * Both choices are exposed in the settings dialog and persisted under
 * `dropbox-interface:settings-v1`. Subscribers can listen to changes
 * via `subscribeSettings(cb)`; the SettingsDialog uses this to react
 * to its own writes without prop drilling.
 */

const STORAGE_KEY = "dropbox-interface:settings-v1";

export type Theme = "light" | "dark" | "system";
export type DashboardLayout = "stacked" | "grid" | "compact";

export type Settings = {
  theme: Theme;
  dashboardLayout: DashboardLayout;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  dashboardLayout: "grid",
};

const VALID_THEMES: Theme[] = ["light", "dark", "system"];
const VALID_LAYOUTS: DashboardLayout[] = ["stacked", "grid", "compact"];

function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (VALID_THEMES as string[]).includes(v);
}
function isLayout(v: unknown): v is DashboardLayout {
  return typeof v === "string" && (VALID_LAYOUTS as string[]).includes(v);
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const o = parsed as Record<string, unknown>;
    return {
      theme: isTheme(o.theme) ? o.theme : DEFAULT_SETTINGS.theme,
      dashboardLayout: isLayout(o.dashboardLayout)
        ? o.dashboardLayout
        : DEFAULT_SETTINGS.dashboardLayout,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private mode / quota */
  }
  notifySubscribers(settings);
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  notifySubscribers(DEFAULT_SETTINGS);
}

// ---- subscribe / notify ---------------------------------------------------

const subscribers = new Set<(s: Settings) => void>();

/**
 * Listen for settings changes within the current process. Returns an
 * unsubscribe function. Used by `applyTheme` (so the OS-system theme
 * tracker can re-apply when the user switches between explicit and
 * "system") and by any UI that wants to react without prop-drilling.
 */
export function subscribeSettings(cb: (s: Settings) => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

function notifySubscribers(settings: Settings): void {
  for (const cb of subscribers) {
    try {
      cb(settings);
    } catch {
      /* never let one bad subscriber break the others */
    }
  }
}

// ---- theme application ----------------------------------------------------

/**
 * Resolve a `Theme` to "dark" or "light" by consulting the OS when
 * the value is "system". Pure (no DOM access) so it's testable.
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme;
}

/**
 * Apply a Theme to the document root. Idempotent. Sets up an OS
 * `matchMedia` listener on first call so "system" theme tracks
 * changes; subsequent calls reuse the same listener.
 *
 * Returns a teardown function — not strictly necessary in production
 * (we install once at boot) but useful in tests so each test starts
 * fresh.
 */
export function applyTheme(theme: Theme): () => void {
  if (typeof window === "undefined") return () => {};

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;

  function paint() {
    const resolved = resolveTheme(theme, mq.matches);
    if (resolved === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }

  paint();

  if (theme === "system") {
    const onChange = () => paint();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }
  return () => {};
}
