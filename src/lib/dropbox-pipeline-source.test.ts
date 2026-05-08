import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  DropboxPipelineSource,
  joinDropboxPath,
} from "./dropbox-pipeline-source";

beforeEach(() => {
  vi.stubEnv("VITE_DROPBOX_APP_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("joinDropboxPath", () => {
  it("treats empty parent as root", () => {
    expect(joinDropboxPath("", ".dropbox-interface.json")).toBe(
      "/.dropbox-interface.json",
    );
  });
  it('treats "/" parent as root', () => {
    expect(joinDropboxPath("/", "x")).toBe("/x");
  });
  it("joins nested parents without doubling slashes", () => {
    expect(joinDropboxPath("/a/b", "c")).toBe("/a/b/c");
  });
  it("strips a trailing slash from the parent", () => {
    expect(joinDropboxPath("/a/b/", "c")).toBe("/a/b/c");
    expect(joinDropboxPath("/a/b///", "c")).toBe("/a/b/c");
  });
});

describe("DropboxPipelineSource.loadConfig", () => {
  it("returns null when dropbox_read_text_file reports the file is absent", async () => {
    setInvokeHandler("dropbox_read_text_file", (args) => {
      expect(args).toMatchObject({
        path: "/parent/.dropbox-interface.json",
      });
      return null;
    });
    const src = new DropboxPipelineSource();
    await expect(src.loadConfig("/parent")).resolves.toBeNull();
  });

  it("parses a valid JSON body into a value", async () => {
    setInvokeHandler(
      "dropbox_read_text_file",
      () => '{"version": 1, "kind": "pipeline"}',
    );
    const src = new DropboxPipelineSource();
    await expect(src.loadConfig("/parent")).resolves.toEqual({
      version: 1,
      kind: "pipeline",
    });
  });

  it("wraps invalid JSON in a descriptive error", async () => {
    setInvokeHandler("dropbox_read_text_file", () => "{not json");
    const src = new DropboxPipelineSource();
    await expect(src.loadConfig("/parent")).rejects.toThrow(
      /not valid JSON/,
    );
  });

  it("propagates Rust-side errors verbatim", async () => {
    setInvokeHandler("dropbox_read_text_file", () => {
      throw new Error("dropbox returned an error: 401 invalid_token");
    });
    const src = new DropboxPipelineSource();
    await expect(src.loadConfig("/parent")).rejects.toThrow(
      /invalid_token/,
    );
  });

  it("targets root config at /.dropbox-interface.json for empty parent", async () => {
    const captured: string[] = [];
    setInvokeHandler("dropbox_read_text_file", (args) => {
      captured.push((args as { path: string }).path);
      return null;
    });
    const src = new DropboxPipelineSource();
    await src.loadConfig("");
    await src.loadConfig("/");
    expect(captured).toEqual([
      "/.dropbox-interface.json",
      "/.dropbox-interface.json",
    ]);
  });
});

describe("DropboxPipelineSource.listChildren", () => {
  it("normalizes Dropbox entries into EntryHandle shape", async () => {
    setInvokeHandler("dropbox_list_folder", (args) => {
      expect(args).toMatchObject({ path: "/parent" });
      return [
        {
          kind: "folder",
          name: "Sub",
          path: "/parent/sub",
          displayPath: "/parent/Sub",
          size: null,
          serverModified: null,
        },
        {
          kind: "file",
          name: "x.txt",
          path: "/parent/x.txt",
          displayPath: "/parent/x.txt",
          size: 9,
          serverModified: "2025-01-02T00:00:00Z",
        },
      ];
    });
    const src = new DropboxPipelineSource();
    const out = await src.listChildren("/parent");
    expect(out).toEqual([
      { name: "Sub", path: "/parent/sub", isDirectory: true },
      { name: "x.txt", path: "/parent/x.txt", isDirectory: false },
    ]);
  });

  it('translates "/" to "" before calling dropbox_list_folder', async () => {
    const captured: string[] = [];
    setInvokeHandler("dropbox_list_folder", (args) => {
      captured.push((args as { path: string }).path);
      return [];
    });
    const src = new DropboxPipelineSource();
    await src.listChildren("/");
    expect(captured).toEqual([""]);
  });
});
