import { describe, expect, it } from "vitest";

import { APPS, findApp } from "./registry";

describe("APPS registry", () => {
  it("registers a non-empty list of apps", () => {
    expect(APPS.length).toBeGreaterThan(0);
  });

  it("every descriptor has a non-empty id, title, and render fn", () => {
    for (const app of APPS) {
      expect(app.id.length).toBeGreaterThan(0);
      expect(app.title.length).toBeGreaterThan(0);
      expect(typeof app.render).toBe("function");
      expect(app.dashboardCard.description.length).toBeGreaterThan(0);
      expect(app.dashboardCard.icon).toBeTruthy();
    }
  });

  it("ids are unique across the registry", () => {
    const ids = APPS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("ids are URL-safe slugs (lowercase a-z, 0-9, _-)", () => {
    for (const app of APPS) {
      expect(app.id).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
    }
  });
});

describe("findApp", () => {
  it("returns the descriptor when the id is registered", () => {
    expect(findApp("dropbox")?.id).toBe("dropbox");
    expect(findApp("crm")?.id).toBe("crm");
  });

  it("returns undefined for an unknown id", () => {
    expect(findApp("nope")).toBeUndefined();
  });
});
