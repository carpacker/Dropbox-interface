import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addRecentPipeline,
  clearRecentPipelines,
  getRecentPipelines,
  MAX_RECENT_PIPELINES,
} from "./pipeline-recents";

beforeEach(() => {
  localStorage.clear();
});

describe("getRecentPipelines", () => {
  it("returns empty array when nothing is stored", () => {
    expect(getRecentPipelines()).toEqual([]);
  });

  it("ignores malformed JSON in storage", () => {
    localStorage.setItem("dropbox-interface:recent-pipelines", "{not-json");
    expect(getRecentPipelines()).toEqual([]);
  });

  it("ignores non-array storage", () => {
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify({ recents: [] }),
    );
    expect(getRecentPipelines()).toEqual([]);
  });

  it("filters out malformed entries", () => {
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify([
        { path: "/A", name: "A", visitedAt: 1 },
        { path: 123, name: "X", visitedAt: 2 }, // bad path type
        { path: "/B", visitedAt: 3 }, // missing name
        { path: "/C", name: "C", visitedAt: "later" }, // bad timestamp
        { path: "/D", name: "D", visitedAt: 4 },
      ]),
    );
    expect(getRecentPipelines().map((r) => r.path)).toEqual(["/A", "/D"]);
  });

  it("returns at most MAX_RECENT_PIPELINES entries even if storage has more", () => {
    const stored = Array.from({ length: 10 }, (_, i) => ({
      path: `/p${i}`,
      name: `P${i}`,
      visitedAt: i,
    }));
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify(stored),
    );
    expect(getRecentPipelines()).toHaveLength(MAX_RECENT_PIPELINES);
  });

  it("survives a getItem that throws", () => {
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(getRecentPipelines()).toEqual([]);
    spy.mockRestore();
  });
});

describe("addRecentPipeline", () => {
  it("inserts a single entry at the head", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 100);
    const recents = getRecentPipelines();
    expect(recents).toEqual([{ path: "/A", name: "A", visitedAt: 100 }]);
  });

  it("preserves order across multiple inserts (MRU first)", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    addRecentPipeline({ path: "/B", name: "B" }, () => 2);
    addRecentPipeline({ path: "/C", name: "C" }, () => 3);
    expect(getRecentPipelines().map((r) => r.path)).toEqual(["/C", "/B", "/A"]);
  });

  it("deduplicates by path, refreshing visitedAt and moving to front", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    addRecentPipeline({ path: "/B", name: "B" }, () => 2);
    addRecentPipeline({ path: "/A", name: "A v2" }, () => 3);
    const recents = getRecentPipelines();
    expect(recents.map((r) => r.path)).toEqual(["/A", "/B"]);
    expect(recents[0]).toMatchObject({
      path: "/A",
      name: "A v2",
      visitedAt: 3,
    });
  });

  it("caps the list at MAX_RECENT_PIPELINES", () => {
    for (let i = 0; i < MAX_RECENT_PIPELINES + 3; i++) {
      addRecentPipeline({ path: `/p${i}`, name: `P${i}` }, () => i);
    }
    const recents = getRecentPipelines();
    expect(recents).toHaveLength(MAX_RECENT_PIPELINES);
    expect(recents[0].path).toBe(`/p${MAX_RECENT_PIPELINES + 2}`);
  });

  it("does not throw when setItem rejects (e.g. quota)", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() =>
      addRecentPipeline({ path: "/A", name: "A" }, () => 1),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("uses Date.now by default", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(42);
    addRecentPipeline({ path: "/A", name: "A" });
    expect(getRecentPipelines()[0].visitedAt).toBe(42);
    spy.mockRestore();
  });
});

describe("clearRecentPipelines", () => {
  it("wipes the stored list", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    clearRecentPipelines();
    expect(getRecentPipelines()).toEqual([]);
  });

  it("is a no-op when nothing is stored", () => {
    expect(() => clearRecentPipelines()).not.toThrow();
  });
});

afterEach(() => {
  localStorage.clear();
});
