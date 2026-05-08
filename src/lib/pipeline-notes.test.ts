import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAllNotes,
  deleteNote,
  getAllNotes,
  getNote,
  setNote,
} from "./pipeline-notes";

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  localStorage.clear();
});

describe("getNote / setNote", () => {
  it("returns null when no note is stored", () => {
    expect(getNote("/p/x")).toBeNull();
  });

  it("round-trips a simple note", () => {
    setNote("/p/x", "Looks great", () => 1234);
    expect(getNote("/p/x")).toEqual({ body: "Looks great", updatedAt: 1234 });
  });

  it("trims surrounding whitespace before saving", () => {
    setNote("/p/x", "   needs work   ", () => 1);
    expect(getNote("/p/x")?.body).toBe("needs work");
  });

  it("an empty body deletes an existing note", () => {
    setNote("/p/x", "first", () => 1);
    setNote("/p/x", "", () => 2);
    expect(getNote("/p/x")).toBeNull();
  });

  it("a whitespace-only body also deletes an existing note", () => {
    setNote("/p/x", "first", () => 1);
    setNote("/p/x", "   \n  ", () => 2);
    expect(getNote("/p/x")).toBeNull();
  });

  it("an empty body for an absent path is a no-op", () => {
    setNote("/p/never-existed", "", () => 1);
    expect(getNote("/p/never-existed")).toBeNull();
    // And we did NOT write an empty record to storage.
    expect(
      localStorage.getItem("dropbox-interface:pipeline-notes"),
    ).toBeNull();
  });

  it("overwrites an existing note in place", () => {
    setNote("/p/x", "first", () => 1);
    setNote("/p/x", "second", () => 2);
    expect(getNote("/p/x")).toEqual({ body: "second", updatedAt: 2 });
  });

  it("uses Date.now by default", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(42);
    setNote("/p/x", "hi");
    expect(getNote("/p/x")?.updatedAt).toBe(42);
    spy.mockRestore();
  });

  it("survives non-localStorage / throwing storage", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => setNote("/p/x", "hi")).not.toThrow();
    spy.mockRestore();
  });
});

describe("getAllNotes", () => {
  it("returns {} for empty storage", () => {
    expect(getAllNotes()).toEqual({});
  });

  it("returns every stored note, keyed by path", () => {
    setNote("/p/a", "A", () => 1);
    setNote("/p/b", "B", () => 2);
    expect(getAllNotes()).toEqual({
      "/p/a": { body: "A", updatedAt: 1 },
      "/p/b": { body: "B", updatedAt: 2 },
    });
  });

  it("filters out malformed values from storage", () => {
    localStorage.setItem(
      "dropbox-interface:pipeline-notes",
      JSON.stringify({
        "/p/good": { body: "ok", updatedAt: 1 },
        "/p/bad-time": { body: "ok", updatedAt: "later" }, // invalid
        "/p/no-body": { updatedAt: 1 }, // missing body
        "": { body: "ok", updatedAt: 1 }, // empty key
      }),
    );
    expect(getAllNotes()).toEqual({
      "/p/good": { body: "ok", updatedAt: 1 },
    });
  });

  it("returns {} for non-object root JSON", () => {
    localStorage.setItem(
      "dropbox-interface:pipeline-notes",
      JSON.stringify(["nope"]),
    );
    expect(getAllNotes()).toEqual({});
  });

  it("returns {} for malformed JSON", () => {
    localStorage.setItem("dropbox-interface:pipeline-notes", "{not-json");
    expect(getAllNotes()).toEqual({});
  });
});

describe("deleteNote / clearAllNotes", () => {
  it("deleteNote removes a single entry", () => {
    setNote("/p/a", "A", () => 1);
    setNote("/p/b", "B", () => 2);
    deleteNote("/p/a");
    expect(getNote("/p/a")).toBeNull();
    expect(getNote("/p/b")?.body).toBe("B");
  });

  it("deleteNote on an absent path is a no-op", () => {
    expect(() => deleteNote("/p/never")).not.toThrow();
  });

  it("clearAllNotes wipes everything", () => {
    setNote("/p/a", "A", () => 1);
    setNote("/p/b", "B", () => 2);
    clearAllNotes();
    expect(getAllNotes()).toEqual({});
  });
});
