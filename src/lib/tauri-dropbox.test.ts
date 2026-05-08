import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  dropboxAppKey,
  dropboxConnect,
  dropboxDisconnect,
  dropboxIsConfigured,
  dropboxListFolder,
  dropboxParent,
  dropboxStatus,
  type DropboxAccount,
  type DropboxEntry,
} from "./tauri-dropbox";

beforeEach(() => {
  vi.stubEnv("VITE_DROPBOX_APP_KEY", "test-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("dropboxAppKey + dropboxIsConfigured", () => {
  it("returns the env value when present", () => {
    vi.stubEnv("VITE_DROPBOX_APP_KEY", "abc123");
    expect(dropboxAppKey()).toBe("abc123");
    expect(dropboxIsConfigured()).toBe(true);
  });

  it("trims whitespace", () => {
    vi.stubEnv("VITE_DROPBOX_APP_KEY", "   abc   ");
    expect(dropboxAppKey()).toBe("abc");
  });

  it("treats empty string as not configured", () => {
    vi.stubEnv("VITE_DROPBOX_APP_KEY", "");
    expect(dropboxIsConfigured()).toBe(false);
  });

  it("treats whitespace-only as not configured", () => {
    vi.stubEnv("VITE_DROPBOX_APP_KEY", "   ");
    expect(dropboxIsConfigured()).toBe(false);
  });
});

describe("dropboxParent", () => {
  it("returns null for empty input", () => {
    expect(dropboxParent("")).toBeNull();
  });

  it("returns null for the root path", () => {
    expect(dropboxParent("/")).toBeNull();
  });

  it("returns root ('') for direct children of root", () => {
    expect(dropboxParent("/Photos")).toBe("");
  });

  it("returns parent for nested paths", () => {
    expect(dropboxParent("/Photos/2024")).toBe("/Photos");
    expect(dropboxParent("/a/b/c.txt")).toBe("/a/b");
  });

  it("strips trailing slashes before computing parent", () => {
    expect(dropboxParent("/Photos/")).toBe("");
  });

  it("returns null for a path with no slashes", () => {
    expect(dropboxParent("file.txt")).toBeNull();
  });
});

describe("invoke wrappers", () => {
  it("dropboxStatus forwards the configured app key and returns the account", async () => {
    const account: DropboxAccount = {
      accountId: "id",
      displayName: "D",
      email: "e",
    };
    setInvokeHandler("dropbox_status", (args) => {
      expect(args).toEqual({ appKey: "test-key" });
      return account;
    });
    await expect(dropboxStatus()).resolves.toEqual(account);
  });

  it("dropboxStatus may return null", async () => {
    setInvokeHandler("dropbox_status", () => null);
    await expect(dropboxStatus()).resolves.toBeNull();
  });

  it("dropboxConnect forwards the app key", async () => {
    const account: DropboxAccount = {
      accountId: "id",
      displayName: "D",
      email: "e",
    };
    setInvokeHandler("dropbox_connect", (args) => {
      expect(args).toEqual({ appKey: "test-key" });
      return account;
    });
    await expect(dropboxConnect()).resolves.toEqual(account);
  });

  it("dropboxDisconnect forwards the app key", async () => {
    const spy = vi.fn(() => undefined);
    setInvokeHandler("dropbox_disconnect", spy);
    await dropboxDisconnect();
    expect(spy).toHaveBeenCalledWith({ appKey: "test-key" });
  });

  it("dropboxListFolder forwards the app key and path", async () => {
    const entries: DropboxEntry[] = [
      {
        kind: "folder",
        name: "Photos",
        path: "/photos",
        displayPath: "/Photos",
        size: null,
        serverModified: null,
      },
    ];
    setInvokeHandler("dropbox_list_folder", (args) => {
      expect(args).toEqual({ appKey: "test-key", path: "/some/path" });
      return entries;
    });
    await expect(dropboxListFolder("/some/path")).resolves.toEqual(entries);
  });

  it("propagates rust-side errors verbatim", async () => {
    setInvokeHandler("dropbox_list_folder", () => {
      throw new Error("not connected to Dropbox");
    });
    await expect(dropboxListFolder("")).rejects.toThrow(
      "not connected to Dropbox",
    );
  });
});
