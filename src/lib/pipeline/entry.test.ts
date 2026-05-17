import { describe, expect, it } from "vitest";

import type { FsEntry } from "@/lib/tauri-fs";

import { fsEntryToPipelineEntry } from "./entry";

function fs(over: Partial<FsEntry> = {}): FsEntry {
  return {
    name: "a.txt",
    path: "/p/a.txt",
    isDirectory: false,
    size: 12,
    modified: 1_700_000_000, // unix seconds
    ...over,
  };
}

describe("fsEntryToPipelineEntry", () => {
  it("maps a file with size + modified", () => {
    expect(fsEntryToPipelineEntry(fs())).toEqual({
      kind: "file",
      name: "a.txt",
      path: "/p/a.txt",
      displayPath: "/p/a.txt",
      size: 12,
      serverModified: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("maps a directory (kind=folder, size passthrough)", () => {
    const got = fsEntryToPipelineEntry(
      fs({ isDirectory: true, name: "sub", path: "/p/sub", size: null }),
    );
    expect(got.kind).toBe("folder");
    expect(got.size).toBeNull();
  });

  it("nulls serverModified when modified is null", () => {
    const got = fsEntryToPipelineEntry(fs({ modified: null }));
    expect(got.serverModified).toBeNull();
  });

  it("uses path for displayPath (no Dropbox-style canonicalization on local)", () => {
    const got = fsEntryToPipelineEntry(fs({ path: "/Some/Path/a.txt" }));
    expect(got.displayPath).toBe("/Some/Path/a.txt");
  });
});
