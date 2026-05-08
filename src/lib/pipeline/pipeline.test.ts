import { describe, expect, it } from "vitest";

import {
  CONFIG_FILENAME,
  classifyParentListing,
  findState,
  inboxCount,
  nextState,
  type EntryHandle,
} from "./pipeline";
import { parseConfig } from "./schema";

function configOf(...states: { id: string; folder: string; terminal?: boolean }[]) {
  const r = parseConfig({
    version: 1,
    kind: "pipeline",
    states: states.map((s) => ({
      id: s.id,
      folder: s.folder,
      name: s.id,
      ...(s.terminal ? { terminal: true } : {}),
    })),
  });
  if (!r.ok) {
    throw new Error(`fixture failed schema: ${JSON.stringify(r.issues)}`);
  }
  return r.config;
}

function entry(name: string, isDirectory = true): EntryHandle {
  return { name, path: `/p/${name}`, isDirectory };
}

describe("findState", () => {
  it("returns the matching state by id", () => {
    const c = configOf(
      { id: "a", folder: "1__A" },
      { id: "b", folder: "2__B" },
    );
    expect(findState(c, "b")?.folder).toBe("2__B");
  });

  it("returns null for unknown ids", () => {
    const c = configOf({ id: "a", folder: "1__A" });
    expect(findState(c, "missing")).toBeNull();
  });
});

describe("nextState", () => {
  it("returns the next state in declared order", () => {
    const c = configOf(
      { id: "a", folder: "1__A" },
      { id: "b", folder: "2__B" },
      { id: "c", folder: "3__C" },
    );
    expect(nextState(c, "a")?.id).toBe("b");
    expect(nextState(c, "b")?.id).toBe("c");
  });

  it("returns null at the last state", () => {
    const c = configOf({ id: "a", folder: "1__A" }, { id: "b", folder: "2__B" });
    expect(nextState(c, "b")).toBeNull();
  });

  it("returns null when the current state is terminal even if a successor exists", () => {
    const c = configOf(
      { id: "a", folder: "1__A", terminal: true },
      { id: "b", folder: "2__B" },
    );
    expect(nextState(c, "a")).toBeNull();
  });

  it("returns null for unknown ids", () => {
    const c = configOf({ id: "a", folder: "1__A" });
    expect(nextState(c, "missing")).toBeNull();
  });
});

describe("classifyParentListing", () => {
  const c = configOf(
    { id: "processing", folder: "1__Processing" },
    { id: "ready", folder: "2__ready" },
  );

  it("maps state folders by id and ignores the config file", () => {
    const result = classifyParentListing(
      [
        entry("1__Processing"),
        entry("2__ready"),
        { name: CONFIG_FILENAME, path: "/p/.dropbox-interface.json", isDirectory: false },
      ],
      c,
    );
    expect(result.stateFolders.processing.name).toBe("1__Processing");
    expect(result.stateFolders.ready.name).toBe("2__ready");
    expect(result.inbox).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  it("collects items outside any state folder into the inbox", () => {
    const stray = entry("readme.txt", false);
    const looseFolder = entry("Misc");
    const result = classifyParentListing(
      [entry("1__Processing"), stray, looseFolder],
      c,
    );
    expect(result.inbox).toEqual([stray, looseFolder]);
  });

  it("reports declared states whose folder is missing from the listing", () => {
    const result = classifyParentListing([entry("1__Processing")], c);
    expect(result.missing.map((s) => s.id)).toEqual(["ready"]);
    // The present folder is still mapped.
    expect(result.stateFolders.processing.name).toBe("1__Processing");
    // Missing states do not get an entry in stateFolders.
    expect(result.stateFolders.ready).toBeUndefined();
  });

  it("only matches state folders that are directories — not same-named files", () => {
    // A *file* named "1__Processing" should not satisfy the state.
    const result = classifyParentListing(
      [{ name: "1__Processing", path: "/p/1__Processing", isDirectory: false }],
      c,
    );
    expect(result.stateFolders.processing).toBeUndefined();
    expect(result.missing.map((s) => s.id)).toContain("processing");
    // ...and the file falls into the inbox bucket.
    expect(result.inbox.map((e) => e.name)).toEqual(["1__Processing"]);
  });

  it("matches state folders case-sensitively", () => {
    // Dropbox itself is case-insensitive but path_display preserves case;
    // we want exact matches against the configured folder string.
    const result = classifyParentListing([entry("1__processing")], c);
    expect(result.stateFolders.processing).toBeUndefined();
    expect(result.inbox.map((e) => e.name)).toEqual(["1__processing"]);
  });

  it("inboxCount returns the inbox length", () => {
    const result = classifyParentListing(
      [entry("1__Processing"), entry("file1.txt", false), entry("file2.txt", false)],
      c,
    );
    expect(inboxCount(result)).toBe(2);
  });

  it("treats the config file as ignored regardless of capitalization match", () => {
    // Exact-name match only — a similarly named file should be treated as
    // an inbox item, NOT silently dropped.
    const result = classifyParentListing(
      [
        { name: ".Dropbox-interface.json", path: "/p/x", isDirectory: false },
      ],
      c,
    );
    expect(result.inbox.map((e) => e.name)).toEqual([".Dropbox-interface.json"]);
  });
});
