import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addRecentCrm,
  clearRecentCrms,
  deriveCrmName,
  getRecentCrms,
  MAX_UNPINNED_CRM_RECENTS,
  setCrmPinned,
} from "./crm-recents";

beforeEach(() => clearRecentCrms());
afterEach(() => clearRecentCrms());

describe("addRecentCrm + getRecentCrms", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(getRecentCrms()).toEqual([]);
  });

  it("stores and returns a single entry", () => {
    addRecentCrm({ path: "/r", name: "R" }, () => 1000);
    expect(getRecentCrms()).toEqual([
      { path: "/r", name: "R", visitedAt: 1000 },
    ]);
  });

  it("deduplicates by path, refreshing visitedAt", () => {
    addRecentCrm({ path: "/r", name: "R" }, () => 1000);
    addRecentCrm({ path: "/r", name: "R-renamed" }, () => 2000);
    const recents = getRecentCrms();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({
      path: "/r",
      name: "R-renamed",
      visitedAt: 2000,
    });
  });

  it("orders MRU first by visitedAt", () => {
    addRecentCrm({ path: "/a", name: "A" }, () => 1000);
    addRecentCrm({ path: "/b", name: "B" }, () => 2000);
    addRecentCrm({ path: "/c", name: "C" }, () => 3000);
    expect(getRecentCrms().map((r) => r.path)).toEqual(["/c", "/b", "/a"]);
  });

  it("caps the unpinned list at MAX_UNPINNED_CRM_RECENTS", () => {
    for (let i = 0; i < MAX_UNPINNED_CRM_RECENTS + 3; i++) {
      addRecentCrm({ path: `/p${i}`, name: `p${i}` }, () => i + 1);
    }
    expect(getRecentCrms()).toHaveLength(MAX_UNPINNED_CRM_RECENTS);
  });

  it("ignores empty-path entries", () => {
    addRecentCrm({ path: "   ", name: "blank" }, () => 1000);
    expect(getRecentCrms()).toEqual([]);
  });
});

describe("setCrmPinned", () => {
  it("flags an existing entry as pinned", () => {
    addRecentCrm({ path: "/r", name: "R" }, () => 1000);
    setCrmPinned("/r", true);
    expect(getRecentCrms()[0]).toMatchObject({ pinned: true });
  });

  it("no-ops when the path isn't already in the list", () => {
    setCrmPinned("/missing", true);
    expect(getRecentCrms()).toEqual([]);
  });

  it("sorts pinned entries above unpinned", () => {
    addRecentCrm({ path: "/old", name: "Old" }, () => 1000);
    addRecentCrm({ path: "/new", name: "New" }, () => 2000);
    setCrmPinned("/old", true);
    // Pinned floats above newer unpinned.
    expect(getRecentCrms().map((r) => r.path)).toEqual(["/old", "/new"]);
  });

  it("pinned entries are not evicted even past the unpinned cap", () => {
    addRecentCrm({ path: "/pinned", name: "P" }, () => 1);
    setCrmPinned("/pinned", true);
    for (let i = 0; i < MAX_UNPINNED_CRM_RECENTS + 3; i++) {
      addRecentCrm({ path: `/p${i}`, name: `p${i}` }, () => 100 + i);
    }
    const recents = getRecentCrms();
    expect(recents.find((r) => r.path === "/pinned")).toBeDefined();
  });
});

describe("deriveCrmName", () => {
  it("returns the last POSIX path component", () => {
    expect(deriveCrmName("/home/user/crm")).toBe("crm");
  });

  it("handles a trailing slash", () => {
    expect(deriveCrmName("/home/user/crm/")).toBe("crm");
  });

  it("returns the last Windows path component", () => {
    expect(deriveCrmName("C:\\Users\\me\\crm")).toBe("crm");
  });

  it("falls back to the raw input when no separator is present", () => {
    expect(deriveCrmName("crm")).toBe("crm");
  });
});
