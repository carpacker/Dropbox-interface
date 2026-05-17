import { describe, expect, it } from "vitest";

import { pickKeyColumn, rowKeyFor, sanitizeKey } from "./crm-row-key";

describe("pickKeyColumn", () => {
  it("prefers `id` case-insensitively", () => {
    expect(pickKeyColumn(["Name", "ID", "Email"])).toBe("ID");
    expect(pickKeyColumn(["name", "id"])).toBe("id");
  });

  it("falls back to `name` when no id column exists", () => {
    expect(pickKeyColumn(["Name", "Email"])).toBe("Name");
  });

  it("falls back to the first column when neither id nor name exists", () => {
    expect(pickKeyColumn(["company", "email"])).toBe("company");
  });

  it("returns null for an empty header list", () => {
    expect(pickKeyColumn([])).toBeNull();
  });
});

describe("sanitizeKey", () => {
  it("replaces path separators with underscores", () => {
    expect(sanitizeKey("Doe/Jane")).toBe("Doe_Jane");
    expect(sanitizeKey("a\\b\\c")).toBe("a_b_c");
  });

  it("strips dot-segments (no path traversal)", () => {
    expect(sanitizeKey("..")).toBe("");
    expect(sanitizeKey("../etc")).toBe("etc");
  });

  it("collapses runs of unsafe characters", () => {
    expect(sanitizeKey("a  -  b")).toBe("a_b");
  });

  it("trims leading/trailing underscores", () => {
    expect(sanitizeKey("___Ada___")).toBe("Ada");
  });

  it("returns empty for an empty input", () => {
    expect(sanitizeKey("")).toBe("");
    expect(sanitizeKey("   ")).toBe("");
  });
});

describe("rowKeyFor", () => {
  it("returns the sanitized value of the chosen column", () => {
    expect(rowKeyFor({ id: "Ada Lovelace", email: "x" }, "id")).toBe(
      "Ada_Lovelace",
    );
  });

  it("returns null when the column is missing", () => {
    expect(rowKeyFor({ name: "Ada" }, "id")).toBeNull();
  });

  it("returns null when sanitization yields an empty string", () => {
    expect(rowKeyFor({ id: "..." }, "id")).toBeNull();
  });
});
