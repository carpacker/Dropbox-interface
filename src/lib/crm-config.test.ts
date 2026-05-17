import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCrmConfig,
  csvPathFor,
  DEFAULT_CRM_CONFIG,
  filesDirFor,
  loadCrmConfig,
  saveCrmConfig,
} from "./crm-config";

beforeEach(() => clearCrmConfig());
afterEach(() => clearCrmConfig());

describe("loadCrmConfig", () => {
  it("returns the default when nothing is stored", () => {
    expect(loadCrmConfig()).toEqual(DEFAULT_CRM_CONFIG);
  });

  it("round-trips a stored rootPath", () => {
    saveCrmConfig({ rootPath: "/home/user/crm" });
    expect(loadCrmConfig().rootPath).toBe("/home/user/crm");
  });

  it("falls back to the default for malformed JSON", () => {
    localStorage.setItem("dropbox-interface:crm:v1", "{nope");
    expect(loadCrmConfig()).toEqual(DEFAULT_CRM_CONFIG);
  });

  it("falls back when the shape is wrong", () => {
    localStorage.setItem(
      "dropbox-interface:crm:v1",
      JSON.stringify({ rootPath: 42 }),
    );
    expect(loadCrmConfig()).toEqual(DEFAULT_CRM_CONFIG);
  });

  it("treats a whitespace-only rootPath as unconfigured", () => {
    saveCrmConfig({ rootPath: "   " });
    expect(loadCrmConfig().rootPath).toBeNull();
  });
});

describe("csvPathFor", () => {
  it("joins with forward slashes for POSIX-style roots", () => {
    expect(csvPathFor("/home/user/crm")).toBe(
      "/home/user/crm/contacts.csv",
    );
  });

  it("strips a trailing slash before joining", () => {
    expect(csvPathFor("/home/user/crm/")).toBe(
      "/home/user/crm/contacts.csv",
    );
  });

  it("uses backslashes for Windows-style roots", () => {
    expect(csvPathFor("C:\\Users\\me\\crm")).toBe(
      "C:\\Users\\me\\crm\\contacts.csv",
    );
  });
});

describe("filesDirFor", () => {
  it("nests under <root>/files/<key>", () => {
    expect(filesDirFor("/home/user/crm", "ada")).toBe(
      "/home/user/crm/files/ada",
    );
  });

  it("uses backslashes on Windows-style roots", () => {
    expect(filesDirFor("C:\\Users\\me\\crm", "ada")).toBe(
      "C:\\Users\\me\\crm\\files\\ada",
    );
  });
});
