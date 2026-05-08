import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it("joins truthy class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, undefined, null, "", "b")).toBe("a b");
  });

  it("supports clsx-style object form", () => {
    expect(cn("a", { b: true, c: false }, ["d", "e"])).toBe("a b d e");
  });

  it("merges conflicting tailwind classes via tailwind-merge", () => {
    // p-2 should be overridden by p-4 (later wins)
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("preserves non-tailwind duplicates (clsx behaviour)", () => {
    // tailwind-merge only collapses conflicting tailwind utilities,
    // not arbitrary repeated tokens.
    expect(cn("a", "a")).toBe("a a");
  });

  it("returns empty string for no input", () => {
    expect(cn()).toBe("");
  });
});
