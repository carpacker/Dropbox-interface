import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";

describe("parseCsv — happy path", () => {
  it("parses a minimal header + row", () => {
    const r = parseCsv("name,email\nada,ada@example.com");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.headers).toEqual(["name", "email"]);
    expect(r.rows).toEqual([{ name: "ada", email: "ada@example.com" }]);
  });

  it("handles a trailing newline", () => {
    const r = parseCsv("name,email\nada,ada@example.com\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toHaveLength(1);
  });

  it("handles CRLF line endings", () => {
    const r = parseCsv("a,b\r\n1,2\r\n3,4");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("skips blank lines between rows", () => {
    const r = parseCsv("a,b\n1,2\n\n3,4\n");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([
      { a: "1", b: "2" },
      { a: "3", b: "4" },
    ]);
  });

  it("pads missing trailing cells with empty strings", () => {
    const r = parseCsv("a,b,c\n1,2");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([{ a: "1", b: "2", c: "" }]);
  });

  it("drops extra cells beyond the header count", () => {
    const r = parseCsv("a,b\n1,2,3,4");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("parseCsv — quoting", () => {
  it("supports commas inside quoted fields", () => {
    const r = parseCsv(`name,note\n"Doe, Jane","loves, commas"`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0]).toEqual({ name: "Doe, Jane", note: "loves, commas" });
  });

  it("supports newlines inside quoted fields", () => {
    const r = parseCsv(`name,note\n"Ada","line one\nline two"\n"Grace","y"`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].note).toBe("line one\nline two");
    expect(r.rows[1].name).toBe("Grace");
  });

  it("handles escaped double-quotes inside a quoted field", () => {
    const r = parseCsv(`x\n"she said ""hi"""`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rows[0].x).toBe('she said "hi"');
  });
});

describe("parseCsv — errors", () => {
  it("flags an unterminated quoted field", () => {
    const r = parseCsv(`x\n"never closed`);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/unterminated/i);
  });

  it("rejects an empty input", () => {
    const r = parseCsv("");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/empty/i);
  });

  it("rejects a header row that's all empty", () => {
    const r = parseCsv(",,\n1,2,3");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/no columns/i);
  });

  it("rejects duplicate header names", () => {
    const r = parseCsv("a,b,a\n1,2,3");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0].message).toMatch(/duplicate header/i);
  });
});

describe("parseCsv — single-column edge cases", () => {
  it("parses a single-column CSV", () => {
    const r = parseCsv("name\nada\ngrace");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.headers).toEqual(["name"]);
    expect(r.rows).toEqual([{ name: "ada" }, { name: "grace" }]);
  });
});
