import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearViewModes,
  DEFAULT_VIEW_MODE,
  getViewMode,
  setViewMode,
  type ViewMode,
} from "./view-mode";

beforeEach(() => {
  clearViewModes();
});
afterEach(() => {
  clearViewModes();
});

describe("getViewMode", () => {
  it("returns the default when no entry is stored", () => {
    expect(getViewMode("/Photos/2024")).toBe(DEFAULT_VIEW_MODE);
  });

  it("round-trips a stored value", () => {
    setViewMode("/Photos/2024", "gallery");
    expect(getViewMode("/Photos/2024")).toBe("gallery");
  });

  it("does not leak between paths", () => {
    setViewMode("/A", "gallery");
    setViewMode("/B", "list");
    expect(getViewMode("/A")).toBe("gallery");
    expect(getViewMode("/B")).toBe("list");
    expect(getViewMode("/C")).toBe(DEFAULT_VIEW_MODE);
  });

  it("falls back to default for malformed JSON", () => {
    localStorage.setItem("dropbox-interface:pipeline-view-mode:v1", "{not json");
    expect(getViewMode("/x")).toBe(DEFAULT_VIEW_MODE);
  });

  it("ignores entries with unknown mode strings", () => {
    localStorage.setItem(
      "dropbox-interface:pipeline-view-mode:v1",
      JSON.stringify({ "/x": "carousel", "/y": "gallery" }),
    );
    expect(getViewMode("/x")).toBe(DEFAULT_VIEW_MODE);
    expect(getViewMode("/y")).toBe("gallery");
  });

  it("falls back when storage is an array, not an object", () => {
    localStorage.setItem(
      "dropbox-interface:pipeline-view-mode:v1",
      JSON.stringify(["gallery"]),
    );
    expect(getViewMode("/x")).toBe(DEFAULT_VIEW_MODE);
  });
});

describe("setViewMode", () => {
  it("persists the value to localStorage", () => {
    setViewMode("/A", "gallery");
    const raw = localStorage.getItem(
      "dropbox-interface:pipeline-view-mode:v1",
    );
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as Record<string, ViewMode>;
    expect(parsed["/A"]).toBe("gallery");
  });

  it("overwrites a previous value for the same path", () => {
    setViewMode("/A", "gallery");
    setViewMode("/A", "list");
    expect(getViewMode("/A")).toBe("list");
  });

  it("storing the default still pins it (round-trip)", () => {
    setViewMode("/A", DEFAULT_VIEW_MODE);
    expect(getViewMode("/A")).toBe(DEFAULT_VIEW_MODE);
    const raw = localStorage.getItem(
      "dropbox-interface:pipeline-view-mode:v1",
    );
    const parsed = JSON.parse(raw as string) as Record<string, ViewMode>;
    expect(parsed["/A"]).toBe(DEFAULT_VIEW_MODE);
  });
});

describe("clearViewModes", () => {
  it("wipes the table", () => {
    setViewMode("/A", "gallery");
    setViewMode("/B", "gallery");
    clearViewModes();
    expect(getViewMode("/A")).toBe(DEFAULT_VIEW_MODE);
    expect(getViewMode("/B")).toBe(DEFAULT_VIEW_MODE);
  });
});
