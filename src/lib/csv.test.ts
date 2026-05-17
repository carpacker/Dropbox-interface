import { describe, expect, it } from "vitest";

import { parseCsv, serializeCsv, type CsvRow } from "./csv";

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

describe("serializeCsv", () => {
  it("serializes a simple header + row + trailing newline", () => {
    expect(
      serializeCsv(
        ["id", "name"],
        [{ id: "ada", name: "Ada Lovelace" }],
      ),
    ).toBe("id,name\nada,Ada Lovelace\n");
  });

  it("escapes fields containing commas", () => {
    expect(
      serializeCsv(
        ["name", "note"],
        [{ name: "Doe, Jane", note: "hi" }],
      ),
    ).toBe('name,note\n"Doe, Jane",hi\n');
  });

  it("escapes fields containing double-quotes by doubling them", () => {
    expect(
      serializeCsv(["q"], [{ q: 'she said "hi"' }]),
    ).toBe('q\n"she said ""hi"""\n');
  });

  it("escapes fields containing newlines", () => {
    expect(
      serializeCsv(["note"], [{ note: "line one\nline two" }]),
    ).toBe('note\n"line one\nline two"\n');
  });

  it("pads missing keys with empty strings (matches parseCsv behavior)", () => {
    expect(
      serializeCsv(["a", "b", "c"], [{ a: "1", c: "3" }]),
    ).toBe("a,b,c\n1,,3\n");
  });

  it("emits header-only output when rows is empty", () => {
    expect(serializeCsv(["id", "name"], [])).toBe("id,name\n");
  });
});

describe("serializeCsv ↔ parseCsv round-trip", () => {
  function roundTrip(headers: string[], rows: CsvRow[]) {
    const out = serializeCsv(headers, rows);
    const reparsed = parseCsv(out);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.headers).toEqual(headers);
    expect(reparsed.rows).toEqual(rows);
  }

  it("survives plain cells", () => {
    roundTrip(
      ["id", "name", "email"],
      [
        { id: "ada", name: "Ada Lovelace", email: "ada@example.com" },
        { id: "linus", name: "Linus Torvalds", email: "linus@example.com" },
      ],
    );
  });

  it("survives commas, quotes, and newlines in cells", () => {
    roundTrip(
      ["x", "y"],
      [
        { x: "Doe, Jane", y: 'she said "hi"\nand left' },
      ],
    );
  });

  it("survives empty cells", () => {
    roundTrip(["a", "b"], [{ a: "", b: "" }]);
  });
});
