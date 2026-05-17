import { describe, expect, it } from "vitest";

import { filterByQuery, matchesQuery } from "./filter";

describe("matchesQuery", () => {
  it("empty query matches anything", () => {
    expect(matchesQuery("anything", "")).toBe(true);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });

  it("single-token substring match (case-insensitive)", () => {
    expect(matchesQuery("Hero Shot Final.png", "hero")).toBe(true);
    expect(matchesQuery("Hero Shot Final.png", "FINAL")).toBe(true);
    expect(matchesQuery("Hero Shot Final.png", "raw")).toBe(false);
  });

  it("multi-token: every token must appear (any order)", () => {
    expect(matchesQuery("Hero Shot Final.png", "hero final")).toBe(true);
    expect(matchesQuery("Hero Shot Final.png", "final hero")).toBe(true);
    expect(matchesQuery("Hero Shot Final.png", "hero raw")).toBe(false);
  });

  it("collapses extra whitespace between tokens", () => {
    expect(matchesQuery("Hero Shot.png", "  hero    shot  ")).toBe(true);
  });

  it("dots and other punctuation are matched literally", () => {
    expect(matchesQuery("a.txt", ".txt")).toBe(true);
    expect(matchesQuery("a.txt", ".jpg")).toBe(false);
  });
});

describe("filterByQuery", () => {
  it("returns the same array reference when the query is empty (no copy)", () => {
    const input = [{ name: "a" }, { name: "b" }];
    expect(filterByQuery(input, "")).toBe(input);
    expect(filterByQuery(input, "   ")).toBe(input);
  });

  it("filters out non-matching entries while preserving order", () => {
    const input = [
      { name: "Cat.jpg" },
      { name: "Dog.jpg" },
      { name: "Catnip.png" },
      { name: "Bird.png" },
    ];
    expect(filterByQuery(input, "cat").map((e) => e.name)).toEqual([
      "Cat.jpg",
      "Catnip.png",
    ]);
  });

  it("multi-token filter narrows further", () => {
    const input = [
      { name: "hero shot final.png" },
      { name: "hero shot raw.png" },
      { name: "scratch final.png" },
    ];
    expect(filterByQuery(input, "hero final").map((e) => e.name)).toEqual([
      "hero shot final.png",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(
      filterByQuery([{ name: "a.png" }], "definitely not here"),
    ).toHaveLength(0);
  });
});
