import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addRecentPipeline,
  clearRecentPipelines,
  getRecentPipelines,
  MAX_UNPINNED_RECENTS,
  setPinned,
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
    // MRU-first; both /A and /D survive, /D is newer.
    expect(getRecentPipelines().map((r) => r.path)).toEqual(["/D", "/A"]);
  });

  it("ignores entries with non-boolean pinned values", () => {
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify([
        { path: "/A", name: "A", visitedAt: 1, pinned: "yes" }, // bad
        { path: "/B", name: "B", visitedAt: 2, pinned: true },
      ]),
    );
    const out = getRecentPipelines();
    expect(out.map((r) => r.path)).toEqual(["/B"]);
  });

  it("returns all stored entries when there are no pinned entries", () => {
    // Reading is no longer pre-capped (cap happens on write); ensure
    // legacy storage with extra entries still returns them — pinning
    // is unbounded by design.
    const stored = Array.from({ length: 10 }, (_, i) => ({
      path: `/p${i}`,
      name: `P${i}`,
      visitedAt: i,
    }));
    localStorage.setItem(
      "dropbox-interface:recent-pipelines",
      JSON.stringify(stored),
    );
    // Read returns whatever was stored (no read-time cap so user
    // who added MAX+ pinned items doesn't lose them on next launch).
    expect(getRecentPipelines()).toHaveLength(10);
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

  it("caps the unpinned section at MAX_UNPINNED_RECENTS", () => {
    for (let i = 0; i < MAX_UNPINNED_RECENTS + 3; i++) {
      addRecentPipeline({ path: `/p${i}`, name: `P${i}` }, () => i);
    }
    const recents = getRecentPipelines();
    expect(recents).toHaveLength(MAX_UNPINNED_RECENTS);
    expect(recents[0].path).toBe(`/p${MAX_UNPINNED_RECENTS + 2}`);
  });

  it("preserves pinned status across a re-add", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    setPinned("/A", true);
    addRecentPipeline({ path: "/A", name: "A v2" }, () => 99);
    const recents = getRecentPipelines();
    expect(recents[0]).toMatchObject({
      path: "/A",
      name: "A v2",
      visitedAt: 99,
      pinned: true,
    });
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

describe("setPinned + sort order", () => {
  it("sorts pinned entries before unpinned entries", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    addRecentPipeline({ path: "/B", name: "B" }, () => 2);
    addRecentPipeline({ path: "/C", name: "C" }, () => 3);
    // /A is older but pinned — should bubble to the top.
    setPinned("/A", true);
    expect(getRecentPipelines().map((r) => r.path)).toEqual(["/A", "/C", "/B"]);
  });

  it("sorts multiple pinned entries by visitedAt within the pinned section", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 10);
    addRecentPipeline({ path: "/B", name: "B" }, () => 20);
    setPinned("/A", true);
    setPinned("/B", true);
    expect(getRecentPipelines().map((r) => r.path)).toEqual(["/B", "/A"]);
  });

  it("pinned entries are never evicted by the unpinned cap", () => {
    addRecentPipeline({ path: "/pinned", name: "Pinned" }, () => 0);
    setPinned("/pinned", true);
    // Push a wave of unpinned entries; pinned should stay.
    for (let i = 0; i < MAX_UNPINNED_RECENTS + 5; i++) {
      addRecentPipeline({ path: `/u${i}`, name: `U${i}` }, () => i + 1);
    }
    const recents = getRecentPipelines();
    expect(recents.find((r) => r.path === "/pinned")).toBeDefined();
    // Total length: 1 pinned + cap-many unpinned.
    expect(recents).toHaveLength(1 + MAX_UNPINNED_RECENTS);
  });

  it("unpinning re-subjects an entry to the cap", () => {
    addRecentPipeline({ path: "/keep", name: "Keep" }, () => 0);
    setPinned("/keep", true);
    for (let i = 0; i < MAX_UNPINNED_RECENTS; i++) {
      addRecentPipeline({ path: `/u${i}`, name: `U${i}` }, () => i + 1);
    }
    setPinned("/keep", false);
    // Now /keep is unpinned and was the oldest (visitedAt: 0); the
    // unpinned cap should drop it on the next write.
    addRecentPipeline({ path: "/new", name: "New" }, () => 1000);
    expect(
      getRecentPipelines().find((r) => r.path === "/keep"),
    ).toBeUndefined();
  });

  it("setPinned is a no-op for paths that have never been visited", () => {
    setPinned("/never-seen", true);
    expect(getRecentPipelines()).toEqual([]);
  });

  it("setPinned strips the pinned field instead of storing pinned: false", () => {
    addRecentPipeline({ path: "/A", name: "A" }, () => 1);
    setPinned("/A", true);
    setPinned("/A", false);
    const stored = JSON.parse(
      localStorage.getItem("dropbox-interface:recent-pipelines")!,
    );
    expect(stored[0]).not.toHaveProperty("pinned");
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
