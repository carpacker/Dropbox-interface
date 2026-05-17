import { describe, expect, it } from "vitest";

import type { CsvRow } from "./csv";

import {
  deriveStatusValues,
  FALLBACK_STATUS,
  pickStatusColumn,
  statusOf,
} from "./job-status";

describe("pickStatusColumn", () => {
  it("picks a column literally named `status` (case-insensitive)", () => {
    expect(pickStatusColumn(["id", "name", "Status"])).toBe("Status");
    expect(pickStatusColumn(["status"])).toBe("status");
  });

  it("returns null when no status column exists", () => {
    expect(pickStatusColumn(["id", "name", "email"])).toBeNull();
  });

  it("ignores leading/trailing whitespace in the header", () => {
    expect(pickStatusColumn(["  status  "])).toBe("  status  ");
  });
});

describe("deriveStatusValues", () => {
  function row(over: Partial<CsvRow> = {}): CsvRow {
    return { id: "x", name: "X", status: "", ...over };
  }

  it("returns the fallback when there's no status column", () => {
    expect(deriveStatusValues([row()], null)).toEqual([FALLBACK_STATUS]);
  });

  it("collects distinct status values in first-seen order", () => {
    expect(
      deriveStatusValues(
        [
          row({ status: "Inquiry" }),
          row({ status: "Booked" }),
          row({ status: "Inquiry" }), // dup
          row({ status: "Editing" }),
        ],
        "status",
      ),
    ).toEqual(["Inquiry", "Booked", "Editing"]);
  });

  it("appends the fallback bucket when any row has empty status", () => {
    expect(
      deriveStatusValues(
        [
          row({ status: "Booked" }),
          row({ status: "" }),
          row({ status: "   " }),
          row({ status: "Editing" }),
        ],
        "status",
      ),
    ).toEqual(["Booked", "Editing", FALLBACK_STATUS]);
  });

  it("returns just the fallback for an empty row set", () => {
    expect(deriveStatusValues([], "status")).toEqual([FALLBACK_STATUS]);
  });

  it("returns just the fallback when no row has a non-empty status", () => {
    expect(
      deriveStatusValues(
        [row({ status: "" }), row({ status: "  " })],
        "status",
      ),
    ).toEqual([FALLBACK_STATUS]);
  });
});

describe("statusOf", () => {
  it("returns the fallback for a missing status column", () => {
    expect(statusOf({ id: "x" }, null)).toBe(FALLBACK_STATUS);
  });

  it("returns the fallback for an empty/whitespace cell", () => {
    expect(statusOf({ status: "" }, "status")).toBe(FALLBACK_STATUS);
    expect(statusOf({ status: "   " }, "status")).toBe(FALLBACK_STATUS);
  });

  it("returns the trimmed cell otherwise", () => {
    expect(statusOf({ status: "  Booked  " }, "status")).toBe("Booked");
  });
});
