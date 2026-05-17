import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  clearSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  resolveTheme,
  saveSettings,
  subscribeSettings,
} from "./settings";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});
afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("loadSettings + saveSettings", () => {
  it("returns DEFAULT_SETTINGS when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips a saved value", () => {
    saveSettings({ theme: "dark", dashboardLayout: "compact" });
    expect(loadSettings()).toEqual({
      theme: "dark",
      dashboardLayout: "compact",
    });
  });

  it("falls back to default for malformed JSON", () => {
    localStorage.setItem("dropbox-interface:settings-v1", "{not-json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per-field when an entry has unknown values", () => {
    localStorage.setItem(
      "dropbox-interface:settings-v1",
      JSON.stringify({ theme: "blueish", dashboardLayout: "stacked" }),
    );
    expect(loadSettings()).toEqual({
      theme: DEFAULT_SETTINGS.theme,
      dashboardLayout: "stacked",
    });
  });

  it("does not throw on storage quota errors", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() =>
      saveSettings({ theme: "dark", dashboardLayout: "grid" }),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("clearSettings resets storage", () => {
    saveSettings({ theme: "dark", dashboardLayout: "compact" });
    clearSettings();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("subscribeSettings", () => {
  it("notifies subscribers on saveSettings", () => {
    const seen: unknown[] = [];
    const unsub = subscribeSettings((s) => seen.push(s));
    saveSettings({ theme: "dark", dashboardLayout: "stacked" });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ theme: "dark", dashboardLayout: "stacked" });
    unsub();
  });

  it("unsub stops further notifications", () => {
    const cb = vi.fn();
    const unsub = subscribeSettings(cb);
    unsub();
    saveSettings({ theme: "dark", dashboardLayout: "grid" });
    expect(cb).not.toHaveBeenCalled();
  });

  it("notifies on clearSettings with the defaults", () => {
    const seen: unknown[] = [];
    const unsub = subscribeSettings((s) => seen.push(s));
    clearSettings();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(DEFAULT_SETTINGS);
    unsub();
  });

  it("a throwing subscriber doesn't break the rest", () => {
    const ok = vi.fn();
    const unsub1 = subscribeSettings(() => {
      throw new Error("kaboom");
    });
    const unsub2 = subscribeSettings(ok);
    saveSettings({ theme: "light", dashboardLayout: "grid" });
    expect(ok).toHaveBeenCalled();
    unsub1();
    unsub2();
  });
});

describe("resolveTheme", () => {
  it("returns the explicit value for light/dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("uses prefersDark when theme is 'system'", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("applyTheme", () => {
  /**
   * matchMedia is stubbed in test/setup.ts as a no-op that always
   * returns matches=false. We override per-test as needed.
   */
  function stubMatchMedia(matches: boolean) {
    const listeners = new Set<(e: MediaQueryListEvent) => void>();
    const mq = {
      matches,
      addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
        listeners.add(cb),
      removeEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) =>
        listeners.delete(cb),
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: () => mq,
    });
    return {
      mq,
      flipMatches(next: boolean) {
        (mq as unknown as { matches: boolean }).matches = next;
        for (const cb of listeners) {
          cb({} as MediaQueryListEvent);
        }
      },
    };
  }

  it("adds the .dark class for explicit 'dark'", () => {
    stubMatchMedia(false);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes the .dark class for explicit 'light'", () => {
    stubMatchMedia(true);
    document.documentElement.classList.add("dark");
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("'system' tracks the OS preference and re-paints when it flips", () => {
    const ctl = stubMatchMedia(false);
    const teardown = applyTheme("system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    ctl.flipMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    ctl.flipMatches(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    teardown();
  });

  it("teardown removes the matchMedia listener so a new applyTheme call is clean", () => {
    const ctl = stubMatchMedia(true);
    const teardown = applyTheme("system");
    teardown();
    // If the listener were still attached, this flip would force the
    // class. Verify it does NOT toggle after teardown.
    document.documentElement.classList.remove("dark");
    ctl.flipMatches(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
