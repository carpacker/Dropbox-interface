import { describe, expect, it, vi } from "vitest";

import { setInvokeHandler } from "@/test/tauri-core-mock";
import {
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "./tauri-terminal";

describe("terminalSpawn", () => {
  it("forwards shell + dimensions to invoke", async () => {
    const spy = vi.fn(() => undefined);
    setInvokeHandler("terminal_spawn", spy);
    await terminalSpawn("bash", 80, 24);
    expect(spy).toHaveBeenCalledWith({ shell: "bash", cols: 80, rows: 24 });
  });

  it("rejects when shell errors", async () => {
    setInvokeHandler("terminal_spawn", () => {
      throw new Error("spawn failed");
    });
    await expect(terminalSpawn("bash", 80, 24)).rejects.toThrow("spawn failed");
  });
});

describe("terminalWrite", () => {
  it("forwards data", async () => {
    const spy = vi.fn(() => undefined);
    setInvokeHandler("terminal_write", spy);
    await terminalWrite("ls\n");
    expect(spy).toHaveBeenCalledWith({ data: "ls\n" });
  });
});

describe("terminalResize", () => {
  it("forwards cols/rows", async () => {
    const spy = vi.fn(() => undefined);
    setInvokeHandler("terminal_resize", spy);
    await terminalResize(120, 40);
    expect(spy).toHaveBeenCalledWith({ cols: 120, rows: 40 });
  });
});

describe("terminalKill", () => {
  it("invokes terminal_kill with no args", async () => {
    const spy = vi.fn(() => undefined);
    setInvokeHandler("terminal_kill", spy);
    await terminalKill();
    expect(spy).toHaveBeenCalledWith({});
  });
});
