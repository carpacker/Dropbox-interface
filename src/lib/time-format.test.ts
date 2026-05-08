import { describe, expect, it } from "vitest";

import { formatRelativeTime } from "./time-format";

describe("formatRelativeTime", () => {
  const now = 1_000_000_000_000;

  it.each([
    [0, "just now"],
    [10_000, "just now"],
    [60_000, "1m ago"],
    [120_000, "2m ago"],
    [60 * 60 * 1000, "1h ago"],
    [3 * 60 * 60 * 1000, "3h ago"],
    [24 * 60 * 60 * 1000, "1d ago"],
    [10 * 24 * 60 * 60 * 1000, "10d ago"],
    [40 * 24 * 60 * 60 * 1000, "1mo ago"],
    [365 * 24 * 60 * 60 * 1000 + 1, "1y ago"],
  ])("delta %i ms → %s (numeric input)", (delta, expected) => {
    expect(formatRelativeTime(now - delta, now)).toBe(expected);
  });

  it("clamps negative deltas to 'just now'", () => {
    expect(formatRelativeTime(now + 10_000, now)).toBe("just now");
  });

  it("accepts ISO-8601 strings", () => {
    const iso = new Date(now - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(iso, now)).toBe("5m ago");
  });

  it("returns empty string for garbage input", () => {
    expect(formatRelativeTime("not a date", now)).toBe("");
    expect(formatRelativeTime(null, now)).toBe("");
    expect(formatRelativeTime(undefined, now)).toBe("");
    expect(formatRelativeTime(Number.NaN, now)).toBe("");
  });
});
