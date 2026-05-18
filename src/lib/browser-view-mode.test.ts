import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearBrowserViewModes,
  DEFAULT_BROWSER_VIEW_MODE,
  getBrowserViewMode,
  setBrowserViewMode,
  type BrowserViewMode,
} from "./browser-view-mode";

beforeEach(() => clearBrowserViewModes());
afterEach(() => clearBrowserViewModes());

describe("getBrowserViewMode", () => {
  it("returns the default when no entry is stored", () => {
    expect(getBrowserViewMode("files")).toBe(DEFAULT_BROWSER_VIEW_MODE);
  });

  it("round-trips a stored value", () => {
    setBrowserViewMode("files", "tile");
    expect(getBrowserViewMode("files")).toBe("tile");
  });

  it("does not leak between browsers", () => {
    setBrowserViewMode("files", "tile");
    setBrowserViewMode("dropbox", "list");
    expect(getBrowserViewMode("files")).toBe("tile");
    expect(getBrowserViewMode("dropbox")).toBe("list");
    expect(getBrowserViewMode("other")).toBe(DEFAULT_BROWSER_VIEW_MODE);
  });

  it("falls back to the default for malformed JSON", () => {
    localStorage.setItem(
      "dropbox-interface:browser-view-mode:v1",
      "{not json",
    );
    expect(getBrowserViewMode("files")).toBe(DEFAULT_BROWSER_VIEW_MODE);
  });

  it("ignores entries with unknown mode strings", () => {
    localStorage.setItem(
      "dropbox-interface:browser-view-mode:v1",
      JSON.stringify({ files: "carousel", dropbox: "tile" }),
    );
    expect(getBrowserViewMode("files")).toBe(DEFAULT_BROWSER_VIEW_MODE);
    expect(getBrowserViewMode("dropbox")).toBe("tile");
  });

  it("falls back when storage is an array, not an object", () => {
    localStorage.setItem(
      "dropbox-interface:browser-view-mode:v1",
      JSON.stringify(["tile"]),
    );
    expect(getBrowserViewMode("files")).toBe(DEFAULT_BROWSER_VIEW_MODE);
  });
});

describe("setBrowserViewMode", () => {
  it("persists the value", () => {
    setBrowserViewMode("files", "tile");
    const raw = localStorage.getItem(
      "dropbox-interface:browser-view-mode:v1",
    );
    const parsed = JSON.parse(raw as string) as Record<
      string,
      BrowserViewMode
    >;
    expect(parsed.files).toBe("tile");
  });

  it("overwrites the previous value for the same browser id", () => {
    setBrowserViewMode("files", "tile");
    setBrowserViewMode("files", "list");
    expect(getBrowserViewMode("files")).toBe("list");
  });
});
