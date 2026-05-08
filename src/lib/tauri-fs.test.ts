import { describe, expect, it } from "vitest";

import { invoke } from "@tauri-apps/api/core";
import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  defaultLocalRoot,
  IMAGE_EXTENSIONS,
  imageSrc,
  isImageFile,
  listDirectory,
  parentDirectory,
  type FsEntry,
} from "./tauri-fs";

describe("isImageFile", () => {
  it.each(IMAGE_EXTENSIONS)("recognizes %s extension", (ext) => {
    expect(isImageFile(`/path/to/file${ext}`)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isImageFile("/PHOTOS/IMG.JPG")).toBe(true);
    expect(isImageFile("/p/x.PnG")).toBe(true);
  });

  it("rejects unsupported extensions", () => {
    expect(isImageFile("/photos/notes.txt")).toBe(false);
    expect(isImageFile("/photos/raw.tiff")).toBe(false);
    expect(isImageFile("/photos/movie.mp4")).toBe(false);
  });

  it("rejects extensionless paths", () => {
    expect(isImageFile("/photos/README")).toBe(false);
    expect(isImageFile("")).toBe(false);
  });

  it("matches when path ends with the extension, even without separator", () => {
    expect(isImageFile("foo.png")).toBe(true);
  });
});

describe("imageSrc", () => {
  it("delegates to convertFileSrc", () => {
    expect(imageSrc("/tmp/pic.jpg")).toBe("asset://localhost//tmp/pic.jpg");
  });
});

describe("defaultLocalRoot", () => {
  it("returns the home directory string", async () => {
    setInvokeHandler("default_local_root", () => "/home/user");
    await expect(defaultLocalRoot()).resolves.toBe("/home/user");
  });

  it("propagates errors", async () => {
    setInvokeHandler("default_local_root", () => {
      throw new Error("HOME unset");
    });
    await expect(defaultLocalRoot()).rejects.toThrow("HOME unset");
  });
});

describe("parentDirectory", () => {
  it("forwards path argument and returns parent", async () => {
    setInvokeHandler("parent_directory", (args) => {
      expect(args).toEqual({ path: "/a/b/c" });
      return "/a/b";
    });
    await expect(parentDirectory("/a/b/c")).resolves.toBe("/a/b");
  });

  it("can return null at filesystem root", async () => {
    setInvokeHandler("parent_directory", () => null);
    await expect(parentDirectory("/")).resolves.toBeNull();
  });
});

describe("listDirectory", () => {
  it("returns entries from invoke", async () => {
    const rows: FsEntry[] = [
      { name: "docs", path: "/u/docs", isDirectory: true, size: null, modified: null },
      {
        name: "a.png",
        path: "/u/a.png",
        isDirectory: false,
        size: 1234,
        modified: 1_700_000_000,
      },
    ];
    setInvokeHandler("list_directory", (args) => {
      expect(args).toEqual({ path: "/u" });
      return rows;
    });
    await expect(listDirectory("/u")).resolves.toEqual(rows);
  });

  it("propagates rust-side errors", async () => {
    setInvokeHandler("list_directory", () => {
      throw new Error("Not a directory: /u/file.txt");
    });
    await expect(listDirectory("/u/file.txt")).rejects.toThrow(
      "Not a directory",
    );
  });
});

describe("invoke wrapper plumbing", () => {
  it("throws if no handler is registered", async () => {
    await expect(invoke("unknown_cmd")).rejects.toThrow(
      'No mock handler for invoke("unknown_cmd")',
    );
  });
});
