import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  dropboxAppKey,
  dropboxConnect,
  dropboxCreateFolder,
  dropboxDisconnect,
  dropboxDownloadToTemp,
  dropboxGetThumbnail,
  dropboxIsConfigured,
  dropboxListFolder,
  dropboxLocalSrc,
  dropboxMove,
  dropboxParent,
  dropboxSaveFileTo,
  dropboxStatus,
  isDropboxImage,
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

  it("dropboxGetThumbnail forwards path + size and returns the data URL", async () => {
    setInvokeHandler("dropbox_get_thumbnail", (args) => {
      expect(args).toEqual({
        appKey: "test-key",
        path: "/Photos/x.jpg",
        size: "w128h128",
      });
      return "data:image/jpeg;base64,AAA=";
    });
    await expect(dropboxGetThumbnail("/Photos/x.jpg", "w128h128")).resolves.toBe(
      "data:image/jpeg;base64,AAA=",
    );
  });

  it("dropboxDownloadToTemp forwards path and returns local path", async () => {
    setInvokeHandler("dropbox_download_to_temp", (args) => {
      expect(args).toEqual({ appKey: "test-key", path: "/x.jpg" });
      return "/tmp/dropbox-interface/preview/abc123-x.jpg";
    });
    await expect(dropboxDownloadToTemp("/x.jpg")).resolves.toBe(
      "/tmp/dropbox-interface/preview/abc123-x.jpg",
    );
  });

  it("dropboxSaveFileTo forwards path + dest and returns bytes written", async () => {
    setInvokeHandler("dropbox_save_file_to", (args) => {
      expect(args).toEqual({
        appKey: "test-key",
        path: "/x.txt",
        dest: "/home/user/x.txt",
      });
      return 42;
    });
    await expect(
      dropboxSaveFileTo("/x.txt", "/home/user/x.txt"),
    ).resolves.toBe(42);
  });

  it("dropboxLocalSrc wraps a path with convertFileSrc", () => {
    expect(dropboxLocalSrc("/tmp/x.jpg")).toBe("asset://localhost//tmp/x.jpg");
  });

  it("dropboxMove forwards from + to and returns the new entry", async () => {
    const moved: DropboxEntry = {
      kind: "file",
      name: "x.png",
      path: "/2__ready/x.png",
      displayPath: "/2__ready/x.png",
      size: 12,
      serverModified: "2025-01-02T00:00:00Z",
    };
    setInvokeHandler("dropbox_move_v2", (args) => {
      expect(args).toEqual({
        appKey: "test-key",
        fromPath: "/1__Processing/x.png",
        toPath: "/2__ready/x.png",
      });
      return moved;
    });
    await expect(
      dropboxMove("/1__Processing/x.png", "/2__ready/x.png"),
    ).resolves.toEqual(moved);
  });

  it("dropboxMove propagates Rust-side conflict errors", async () => {
    setInvokeHandler("dropbox_move_v2", () => {
      throw new Error("dropbox returned an error: 409 to/conflict");
    });
    await expect(dropboxMove("/a", "/b")).rejects.toThrow(/to\/conflict/);
  });

  it("dropboxCreateFolder forwards path and returns the folder", async () => {
    const folder: DropboxEntry = {
      kind: "folder",
      name: "2__ready",
      path: "/2__ready",
      displayPath: "/2__ready",
      size: null,
      serverModified: null,
    };
    setInvokeHandler("dropbox_create_folder_v2", (args) => {
      expect(args).toEqual({ appKey: "test-key", path: "/2__ready" });
      return folder;
    });
    await expect(dropboxCreateFolder("/2__ready")).resolves.toEqual(folder);
  });
});

describe("isDropboxImage", () => {
  function entry(name: string, kind: "file" | "folder" = "file"): DropboxEntry {
    return {
      kind,
      name,
      path: `/p/${name}`,
      displayPath: `/p/${name}`,
      size: 1,
      serverModified: null,
    };
  }

  it.each(["a.jpg", "a.JPG", "a.jpeg", "a.png", "a.gif", "a.webp", "a.bmp"])(
    "recognizes %s",
    (name) => {
      expect(isDropboxImage(entry(name))).toBe(true);
    },
  );

  it("rejects non-image extensions", () => {
    expect(isDropboxImage(entry("a.txt"))).toBe(false);
    expect(isDropboxImage(entry("a.tiff"))).toBe(false);
    expect(isDropboxImage(entry("a.mp4"))).toBe(false);
  });

  it("rejects folders even with image-like names", () => {
    expect(isDropboxImage(entry("photos.jpg", "folder"))).toBe(false);
  });
});
