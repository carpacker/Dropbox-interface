import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSortPreference,
  DEFAULT_SORT,
  formatBytes,
  loadSortPreference,
  saveSortPreference,
  sortEntries,
  type SortableEntry,
} from "./sort";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

function entry(
  name: string,
  extras: Partial<SortableEntry> = {},
): SortableEntry {
  return { name, ...extras };
}

describe("sortEntries — name", () => {
  it("sorts case-insensitively ascending by default", () => {
    const out = sortEntries(
      [entry("zeta"), entry("Alpha"), entry("beta")],
      { key: "name", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["Alpha", "beta", "zeta"]);
  });

  it("descending reverses the order", () => {
    const out = sortEntries(
      [entry("a"), entry("b"), entry("c")],
      { key: "name", direction: "desc" },
    );
    expect(out.map((e) => e.name)).toEqual(["c", "b", "a"]);
  });

  it("keeps folders first by default", () => {
    const out = sortEntries(
      [
        entry("z-file"),
        entry("a-folder", { isDirectory: true }),
        entry("a-file"),
      ],
      { key: "name", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual([
      "a-folder",
      "a-file",
      "z-file",
    ]);
  });

  it("keepFoldersFirst:false interleaves folders with files", () => {
    const out = sortEntries(
      [
        entry("z-file"),
        entry("a-folder", { isDirectory: true }),
        entry("a-file"),
      ],
      { key: "name", direction: "asc" },
      { keepFoldersFirst: false },
    );
    expect(out.map((e) => e.name)).toEqual([
      "a-file",
      "a-folder",
      "z-file",
    ]);
  });

  it("is stable for ties (preserves input order)", () => {
    const out = sortEntries(
      [
        { name: "x", size: 1 },
        { name: "x", size: 2 },
        { name: "x", size: 3 },
      ],
      { key: "name", direction: "asc" },
    );
    expect(out.map((e) => e.size)).toEqual([1, 2, 3]);
  });

  it("returns a new array (does not mutate input)", () => {
    const input = [entry("b"), entry("a")];
    const out = sortEntries(input, DEFAULT_SORT);
    expect(input.map((e) => e.name)).toEqual(["b", "a"]);
    expect(out.map((e) => e.name)).toEqual(["a", "b"]);
  });
});

describe("sortEntries — modified", () => {
  it("sorts by ISO timestamp when present", () => {
    const out = sortEntries(
      [
        entry("a", { modified: "2025-01-02T00:00:00Z" }),
        entry("b", { modified: "2025-01-01T00:00:00Z" }),
        entry("c", { modified: "2025-01-03T00:00:00Z" }),
      ],
      { key: "modified", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["b", "a", "c"]);
  });

  it("descending puts newest first", () => {
    const out = sortEntries(
      [
        entry("old", { modified: 1 }),
        entry("mid", { modified: 5 }),
        entry("new", { modified: 9 }),
      ],
      { key: "modified", direction: "desc" },
    );
    expect(out.map((e) => e.name)).toEqual(["new", "mid", "old"]);
  });

  it("entries with no modified value sort to the end (asc and desc)", () => {
    const ascending = sortEntries(
      [
        entry("a", { modified: 1 }),
        entry("missing"),
        entry("b", { modified: 2 }),
      ],
      { key: "modified", direction: "asc" },
    );
    expect(ascending.map((e) => e.name)).toEqual(["a", "b", "missing"]);

    const descending = sortEntries(
      [
        entry("a", { modified: 1 }),
        entry("missing"),
        entry("b", { modified: 2 }),
      ],
      { key: "modified", direction: "desc" },
    );
    expect(descending.map((e) => e.name)).toEqual(["b", "a", "missing"]);
  });

  it("mixes ISO strings and unix-seconds numbers correctly", () => {
    const out = sortEntries(
      [
        entry("iso", { modified: "2025-01-02T00:00:00Z" }), // sec ≈ 1735776000
        entry("unix", { modified: 1735776100 }), // 100s later
      ],
      { key: "modified", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["iso", "unix"]);
  });

  it("falls back to name compare when modified ties", () => {
    const out = sortEntries(
      [
        entry("zeta", { modified: 1 }),
        entry("alpha", { modified: 1 }),
      ],
      { key: "modified", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["alpha", "zeta"]);
  });

  it("garbage timestamps are treated as missing", () => {
    const out = sortEntries(
      [
        entry("ok", { modified: 1 }),
        entry("bad", { modified: "not a date" }),
      ],
      { key: "modified", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["ok", "bad"]);
  });
});

describe("sortEntries — toSortable accessor", () => {
  it("sorts heterogeneous shapes via the accessor and returns the originals", () => {
    type DropboxLike = {
      kind: "file" | "folder";
      name: string;
      size: number | null;
      serverModified: string | null;
    };
    const items: DropboxLike[] = [
      { kind: "file", name: "z.png", size: 50, serverModified: "2025-01-01T00:00:00Z" },
      { kind: "folder", name: "Sub", size: null, serverModified: null },
      { kind: "file", name: "a.png", size: 200, serverModified: "2025-01-03T00:00:00Z" },
    ];
    const sorted = sortEntries<DropboxLike>(
      items,
      { key: "modified", direction: "desc" },
      {
        toSortable: (e) => ({
          name: e.name,
          size: e.size,
          modified: e.serverModified,
          isDirectory: e.kind === "folder",
        }),
      },
    );
    // Folder first (keepFoldersFirst defaults true), then a.png (newer)
    // before z.png (older).
    expect(sorted.map((e) => e.name)).toEqual(["Sub", "a.png", "z.png"]);
    // Originals are preserved verbatim — we get back DropboxLike objects.
    expect(sorted[1].size).toBe(200);
  });
});

describe("sortEntries — size", () => {
  it("sorts ascending by bytes", () => {
    const out = sortEntries(
      [
        entry("big", { size: 1_000_000 }),
        entry("small", { size: 100 }),
        entry("mid", { size: 5_000 }),
      ],
      { key: "size", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["small", "mid", "big"]);
  });

  it("entries with no size sort to the end", () => {
    const out = sortEntries(
      [entry("a", { size: 100 }), entry("b"), entry("c", { size: 50 })],
      { key: "size", direction: "asc" },
    );
    expect(out.map((e) => e.name)).toEqual(["c", "a", "b"]);
  });
});

describe("loadSortPreference + saveSortPreference", () => {
  it("returns DEFAULT_SORT when nothing is stored", () => {
    expect(loadSortPreference()).toEqual(DEFAULT_SORT);
  });

  it("round-trips a saved preference", () => {
    saveSortPreference({ key: "modified", direction: "desc" });
    expect(loadSortPreference()).toEqual({
      key: "modified",
      direction: "desc",
    });
  });

  it("falls back to default for malformed JSON", () => {
    localStorage.setItem(
      "dropbox-interface:sort-preference-v1",
      "{not-json",
    );
    expect(loadSortPreference()).toEqual(DEFAULT_SORT);
  });

  it("falls back to default for unknown keys/directions", () => {
    localStorage.setItem(
      "dropbox-interface:sort-preference-v1",
      JSON.stringify({ key: "other", direction: "sideways" }),
    );
    expect(loadSortPreference()).toEqual(DEFAULT_SORT);
  });

  it("does not throw when storage rejects the write", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() =>
      saveSortPreference({ key: "size", direction: "asc" }),
    ).not.toThrow();
    spy.mockRestore();
  });

  it("clearSortPreference resets storage", () => {
    saveSortPreference({ key: "size", direction: "desc" });
    clearSortPreference();
    expect(loadSortPreference()).toEqual(DEFAULT_SORT);
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [12, "12 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [2048, "2.0 KB"],
    [9_999, "9.8 KB"],
    [10_240, "10 KB"],
    [1_048_576, "1.0 MB"],
    [10_485_760, "10 MB"],
    [1_073_741_824, "1.0 GB"],
  ])("%i bytes → %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  it("returns empty string for null/undefined/NaN/negative", () => {
    expect(formatBytes(null)).toBe("");
    expect(formatBytes(undefined)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
    expect(formatBytes(-1)).toBe("");
  });
});
