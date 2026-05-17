import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addRecentJobTracker,
  clearRecentJobTrackers,
  deriveJobTrackerName,
  getRecentJobTrackers,
  MAX_UNPINNED_JOB_RECENTS,
  setJobTrackerPinned,
} from "./job-tracker-recents";

beforeEach(() => clearRecentJobTrackers());
afterEach(() => clearRecentJobTrackers());

describe("addRecentJobTracker + getRecentJobTrackers", () => {
  it("starts empty", () => {
    expect(getRecentJobTrackers()).toEqual([]);
  });

  it("stores + returns an entry, MRU first", () => {
    addRecentJobTracker({ path: "/a", name: "A" }, () => 1000);
    addRecentJobTracker({ path: "/b", name: "B" }, () => 2000);
    expect(getRecentJobTrackers().map((r) => r.path)).toEqual(["/b", "/a"]);
  });

  it("dedupes by path, refreshing visitedAt", () => {
    addRecentJobTracker({ path: "/a", name: "A" }, () => 1000);
    addRecentJobTracker({ path: "/a", name: "A-renamed" }, () => 2000);
    const recents = getRecentJobTrackers();
    expect(recents).toHaveLength(1);
    expect(recents[0]).toMatchObject({ name: "A-renamed", visitedAt: 2000 });
  });

  it("caps the unpinned list", () => {
    for (let i = 0; i < MAX_UNPINNED_JOB_RECENTS + 3; i++) {
      addRecentJobTracker({ path: `/p${i}`, name: `p${i}` }, () => i + 1);
    }
    expect(getRecentJobTrackers()).toHaveLength(MAX_UNPINNED_JOB_RECENTS);
  });

  it("ignores empty-path entries", () => {
    addRecentJobTracker({ path: "   ", name: "blank" }, () => 1000);
    expect(getRecentJobTrackers()).toEqual([]);
  });
});

describe("setJobTrackerPinned", () => {
  it("sorts pinned above newer unpinned", () => {
    addRecentJobTracker({ path: "/old", name: "Old" }, () => 1000);
    addRecentJobTracker({ path: "/new", name: "New" }, () => 2000);
    setJobTrackerPinned("/old", true);
    expect(getRecentJobTrackers().map((r) => r.path)).toEqual([
      "/old",
      "/new",
    ]);
  });

  it("pinned entries survive the unpinned eviction cap", () => {
    addRecentJobTracker({ path: "/pinned", name: "P" }, () => 1);
    setJobTrackerPinned("/pinned", true);
    for (let i = 0; i < MAX_UNPINNED_JOB_RECENTS + 3; i++) {
      addRecentJobTracker({ path: `/p${i}`, name: `p${i}` }, () => 100 + i);
    }
    expect(
      getRecentJobTrackers().find((r) => r.path === "/pinned"),
    ).toBeDefined();
  });

  it("no-ops when path isn't present", () => {
    setJobTrackerPinned("/missing", true);
    expect(getRecentJobTrackers()).toEqual([]);
  });
});

describe("deriveJobTrackerName", () => {
  it("returns the last POSIX path component", () => {
    expect(deriveJobTrackerName("/home/user/Z_Job_Manager")).toBe(
      "Z_Job_Manager",
    );
  });

  it("returns the last Windows path component", () => {
    expect(deriveJobTrackerName("C:\\Users\\me\\jobs")).toBe("jobs");
  });

  it("handles a trailing slash", () => {
    expect(deriveJobTrackerName("/r/jobs/")).toBe("jobs");
  });

  it("falls back to the input when there's no separator", () => {
    expect(deriveJobTrackerName("jobs")).toBe("jobs");
  });
});
