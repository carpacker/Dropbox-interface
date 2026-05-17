import { describe, expect, it } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";

import {
  joinLocalPath,
  LocalPipelineSource,
} from "./local-pipeline-source";

describe("joinLocalPath", () => {
  it("treats empty parent as the child path", () => {
    expect(joinLocalPath("", "config.json")).toBe("config.json");
  });

  it("uses forward slashes on POSIX-style parents", () => {
    expect(joinLocalPath("/home/user", ".dropbox-interface.json")).toBe(
      "/home/user/.dropbox-interface.json",
    );
  });

  it("strips a trailing forward slash before joining", () => {
    expect(joinLocalPath("/a/b/", "c")).toBe("/a/b/c");
    expect(joinLocalPath("/a/b///", "c")).toBe("/a/b/c");
  });

  it("uses backslashes on Windows-style drive-letter parents", () => {
    expect(joinLocalPath("C:\\Users\\me", "x.json")).toBe(
      "C:\\Users\\me\\x.json",
    );
    expect(joinLocalPath("C:/Users/me", "x.json")).toBe(
      "C:/Users/me\\x.json",
    );
  });

  it("uses backslashes when the parent already has any backslash", () => {
    expect(joinLocalPath("D:\\Photos\\2024", "y.txt")).toBe(
      "D:\\Photos\\2024\\y.txt",
    );
  });

  it("strips a trailing backslash before joining", () => {
    expect(joinLocalPath("C:\\Users\\me\\", "x.json")).toBe(
      "C:\\Users\\me\\x.json",
    );
  });
});

describe("LocalPipelineSource.loadConfig", () => {
  it("returns null when the config file does not exist", async () => {
    setInvokeHandler("local_read_text_file", (args) => {
      expect(args).toMatchObject({
        path: "/parent/.dropbox-interface.json",
      });
      return null;
    });
    const src = new LocalPipelineSource();
    await expect(src.loadConfig("/parent")).resolves.toBeNull();
  });

  it("parses a valid JSON body into a value", async () => {
    setInvokeHandler(
      "local_read_text_file",
      () => '{"version": 1, "kind": "pipeline"}',
    );
    const src = new LocalPipelineSource();
    await expect(src.loadConfig("/parent")).resolves.toEqual({
      version: 1,
      kind: "pipeline",
    });
  });

  it("wraps invalid JSON in a descriptive error", async () => {
    setInvokeHandler("local_read_text_file", () => "{not json");
    const src = new LocalPipelineSource();
    await expect(src.loadConfig("/parent")).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("propagates rust-side errors verbatim (e.g. size cap)", async () => {
    setInvokeHandler("local_read_text_file", () => {
      throw new Error("file at /x exceeds 256-byte cap");
    });
    const src = new LocalPipelineSource();
    await expect(src.loadConfig("/parent")).rejects.toThrow(/exceeds/);
  });
});

describe("LocalPipelineSource.listChildren", () => {
  it("returns EntryHandle-shaped objects derived from list_directory", async () => {
    setInvokeHandler("list_directory", (args) => {
      expect(args).toMatchObject({ path: "/parent" });
      return [
        {
          name: "1__Processing",
          path: "/parent/1__Processing",
          isDirectory: true,
          size: null,
          modified: 1700000000,
        },
        {
          name: "loose.txt",
          path: "/parent/loose.txt",
          isDirectory: false,
          size: 12,
          modified: 1700000100,
        },
      ];
    });
    const src = new LocalPipelineSource();
    const entries = await src.listChildren("/parent");
    expect(entries).toEqual([
      {
        name: "1__Processing",
        path: "/parent/1__Processing",
        isDirectory: true,
      },
      {
        name: "loose.txt",
        path: "/parent/loose.txt",
        isDirectory: false,
      },
    ]);
  });

  it("propagates rust-side errors verbatim", async () => {
    setInvokeHandler("list_directory", () => {
      throw new Error("Not a directory: /missing");
    });
    const src = new LocalPipelineSource();
    await expect(src.listChildren("/missing")).rejects.toThrow(
      "Not a directory",
    );
  });
});
