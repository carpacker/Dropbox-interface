import { describe, expect, it } from "vitest";

import { parseThread } from "./job-thread";

describe("parseThread", () => {
  it("parses well-formed JSONL into entries", () => {
    const body = [
      JSON.stringify({
        at: "2026-05-01T10:00:00Z",
        by: "Carson",
        kind: "note",
        body: "Initial inquiry email received.",
      }),
      JSON.stringify({
        at: "2026-05-02T14:30:00Z",
        by: "Paige",
        kind: "note",
        body: "Sent quote.",
      }),
    ].join("\n");

    const r = parseThread(body);
    expect(r.skipped).toBe(0);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0].by).toBe("Carson");
    expect(r.entries[1].kind).toBe("note");
  });

  it("preserves entry order from the file", () => {
    const r = parseThread(
      [
        '{"at":"a","by":"x","kind":"note","body":"1"}',
        '{"at":"b","by":"x","kind":"note","body":"2"}',
        '{"at":"c","by":"x","kind":"note","body":"3"}',
      ].join("\n"),
    );
    expect(r.entries.map((e) => e.body)).toEqual(["1", "2", "3"]);
  });

  it("returns an empty result for an empty / whitespace-only file", () => {
    expect(parseThread("")).toEqual({ entries: [], skipped: 0 });
    expect(parseThread("\n  \n  \n")).toEqual({ entries: [], skipped: 0 });
  });

  it("handles CRLF line endings", () => {
    const r = parseThread(
      [
        '{"at":"a","by":"x","kind":"note","body":"1"}',
        '{"at":"b","by":"x","kind":"note","body":"2"}',
      ].join("\r\n"),
    );
    expect(r.entries).toHaveLength(2);
  });

  it("skips lines that fail JSON.parse, counting them", () => {
    const r = parseThread(
      [
        '{"at":"a","by":"x","kind":"note","body":"ok"}',
        "{not json",
        '{"at":"c","by":"x","kind":"note","body":"also ok"}',
      ].join("\n"),
    );
    expect(r.entries).toHaveLength(2);
    expect(r.skipped).toBe(1);
  });

  it("skips lines whose schema is invalid", () => {
    const r = parseThread(
      [
        // missing `kind`
        '{"at":"a","by":"x","body":"oops"}',
        // unknown `kind`
        '{"at":"b","by":"x","kind":"phone","body":"x"}',
        // wrong type for `by`
        '{"at":"c","by":42,"kind":"note","body":"x"}',
        // good
        '{"at":"d","by":"x","kind":"email-link","body":"x"}',
      ].join("\n"),
    );
    expect(r.entries).toHaveLength(1);
    expect(r.entries[0].kind).toBe("email-link");
    expect(r.skipped).toBe(3);
  });
});
