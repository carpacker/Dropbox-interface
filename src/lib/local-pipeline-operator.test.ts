import { describe, expect, it } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";

import { LocalPipelineOperator } from "./local-pipeline-operator";

describe("LocalPipelineOperator", () => {
  it("move forwards to local_move and returns a PipelineEntry", async () => {
    setInvokeHandler("local_move", (args) => {
      expect(args).toMatchObject({
        fromPath: "/parent/loose.txt",
        toPath: "/parent/1__Processing/loose.txt",
      });
      return {
        name: "loose.txt",
        path: "/parent/1__Processing/loose.txt",
        isDirectory: false,
        size: 12,
        modified: 1_700_000_000,
      };
    });
    const op = new LocalPipelineOperator();
    const got = await op.move(
      "/parent/loose.txt",
      "/parent/1__Processing/loose.txt",
    );
    expect(got).toEqual({
      kind: "file",
      name: "loose.txt",
      path: "/parent/1__Processing/loose.txt",
      displayPath: "/parent/1__Processing/loose.txt",
      size: 12,
      serverModified: new Date(1_700_000_000_000).toISOString(),
    });
  });

  it("createFolder forwards to local_create_folder", async () => {
    setInvokeHandler("local_create_folder", (args) => {
      expect(args).toMatchObject({ path: "/parent/2__ready" });
      return {
        name: "2__ready",
        path: "/parent/2__ready",
        isDirectory: true,
        size: null,
        modified: null,
      };
    });
    const op = new LocalPipelineOperator();
    const got = await op.createFolder("/parent/2__ready");
    expect(got.kind).toBe("folder");
    expect(got.serverModified).toBeNull();
  });

  it("listChildren maps FsEntry rows into PipelineEntry rows", async () => {
    setInvokeHandler("list_directory", () => [
      {
        name: "1__Processing",
        path: "/parent/1__Processing",
        isDirectory: true,
        size: null,
        modified: 1_700_000_000,
      },
      {
        name: "x.txt",
        path: "/parent/x.txt",
        isDirectory: false,
        size: 7,
        modified: 1_700_000_100,
      },
    ]);
    const op = new LocalPipelineOperator();
    const rows = await op.listChildren("/parent");
    expect(rows.map((r) => r.kind)).toEqual(["folder", "file"]);
    expect(rows[1].size).toBe(7);
  });

  it("joinPath uses POSIX or Windows separator based on the parent", () => {
    const op = new LocalPipelineOperator();
    expect(op.joinPath("/home/user", "a")).toBe("/home/user/a");
    expect(op.joinPath("C:\\Users\\me", "a")).toBe("C:\\Users\\me\\a");
  });

  it("move propagates rust-side errors verbatim", async () => {
    setInvokeHandler("local_move", () => {
      throw new Error("Destination already exists: /x");
    });
    const op = new LocalPipelineOperator();
    await expect(op.move("/a", "/x")).rejects.toThrow(/already exists/);
  });
});
