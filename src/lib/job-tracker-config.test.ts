import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearJobTrackerConfig,
  DEFAULT_JOB_TRACKER_CONFIG,
  jobFilesDirFor,
  jobsCsvPathFor,
  jobThreadPathFor,
  loadJobTrackerConfig,
  saveJobTrackerConfig,
} from "./job-tracker-config";

beforeEach(() => clearJobTrackerConfig());
afterEach(() => clearJobTrackerConfig());

describe("loadJobTrackerConfig", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadJobTrackerConfig()).toEqual(DEFAULT_JOB_TRACKER_CONFIG);
  });

  it("round-trips a stored rootPath", () => {
    saveJobTrackerConfig({ rootPath: "/home/user/jobs" });
    expect(loadJobTrackerConfig().rootPath).toBe("/home/user/jobs");
  });

  it("falls back to the default for malformed JSON", () => {
    localStorage.setItem("dropbox-interface:job-tracker:v1", "{nope");
    expect(loadJobTrackerConfig()).toEqual(DEFAULT_JOB_TRACKER_CONFIG);
  });

  it("falls back when the shape is wrong", () => {
    localStorage.setItem(
      "dropbox-interface:job-tracker:v1",
      JSON.stringify({ rootPath: 42 }),
    );
    expect(loadJobTrackerConfig()).toEqual(DEFAULT_JOB_TRACKER_CONFIG);
  });

  it("treats a whitespace-only rootPath as unconfigured", () => {
    saveJobTrackerConfig({ rootPath: "   " });
    expect(loadJobTrackerConfig().rootPath).toBeNull();
  });
});

describe("path helpers", () => {
  it("jobsCsvPathFor joins root + jobs.csv with the right separator", () => {
    expect(jobsCsvPathFor("/home/user/jobs")).toBe(
      "/home/user/jobs/jobs.csv",
    );
    expect(jobsCsvPathFor("C:\\Users\\me\\jobs")).toBe(
      "C:\\Users\\me\\jobs\\jobs.csv",
    );
  });

  it("jobsCsvPathFor strips a trailing slash before joining", () => {
    expect(jobsCsvPathFor("/home/user/jobs/")).toBe(
      "/home/user/jobs/jobs.csv",
    );
  });

  it("jobFilesDirFor nests <root>/files/<rowKey>", () => {
    expect(jobFilesDirFor("/r", "alpha")).toBe("/r/files/alpha");
    expect(jobFilesDirFor("C:\\r", "alpha")).toBe(
      "C:\\r\\files\\alpha",
    );
  });

  it("jobThreadPathFor lands at <root>/threads/<rowKey>.jsonl", () => {
    expect(jobThreadPathFor("/r", "alpha")).toBe(
      "/r/threads/alpha.jsonl",
    );
    expect(jobThreadPathFor("C:\\r", "alpha")).toBe(
      "C:\\r\\threads\\alpha.jsonl",
    );
  });
});
