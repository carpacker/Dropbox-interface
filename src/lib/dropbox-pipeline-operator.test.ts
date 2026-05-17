import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";

import { DropboxPipelineOperator } from "./dropbox-pipeline-operator";

beforeEach(() => {
  vi.stubEnv("VITE_DROPBOX_APP_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DropboxPipelineOperator", () => {
  it("move forwards to dropbox_move_v2 and returns the entry", async () => {
    setInvokeHandler("dropbox_move_v2", (args) => {
      expect(args).toMatchObject({
        fromPath: "/a/x.png",
        toPath: "/b/x.png",
      });
      return {
        kind: "file",
        name: "x.png",
        path: "/b/x.png",
        displayPath: "/b/x.png",
        size: 1,
        serverModified: null,
      };
    });
    const op = new DropboxPipelineOperator();
    const got = await op.move("/a/x.png", "/b/x.png");
    expect(got.path).toBe("/b/x.png");
  });

  it("createFolder forwards to dropbox_create_folder_v2", async () => {
    setInvokeHandler("dropbox_create_folder_v2", (args) => {
      expect(args).toMatchObject({ path: "/2__ready" });
      return {
        kind: "folder",
        name: "2__ready",
        path: "/2__ready",
        displayPath: "/2__ready",
        size: null,
        serverModified: null,
      };
    });
    const op = new DropboxPipelineOperator();
    const got = await op.createFolder("/2__ready");
    expect(got.kind).toBe("folder");
  });

  it("listChildren forwards to dropbox_list_folder", async () => {
    setInvokeHandler("dropbox_list_folder", (args) => {
      expect(args).toMatchObject({ path: "/parent" });
      return [];
    });
    const op = new DropboxPipelineOperator();
    await expect(op.listChildren("/parent")).resolves.toEqual([]);
  });

  it("joinPath uses Dropbox semantics (root = empty)", () => {
    const op = new DropboxPipelineOperator();
    expect(op.joinPath("", "x")).toBe("/x");
    expect(op.joinPath("/a/b", "c")).toBe("/a/b/c");
  });
});
