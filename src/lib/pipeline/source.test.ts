import { describe, expect, it } from "vitest";

import { CONFIG_FILENAME, type EntryHandle } from "./pipeline";
import { InMemoryPipelineSource } from "./source";

function dir(name: string): EntryHandle {
  return { name, path: `/${name}`, isDirectory: true };
}
function file(name: string): EntryHandle {
  return { name, path: `/${name}`, isDirectory: false };
}

describe("InMemoryPipelineSource", () => {
  it("returns null when no config has been registered for the parent path", async () => {
    const src = new InMemoryPipelineSource({ "/p": [dir("1__A")] });
    await expect(src.loadConfig("/p")).resolves.toBeNull();
  });

  it("returns the registered config body for a parent path", async () => {
    const body = { version: 1, kind: "pipeline", states: [] };
    const src = new InMemoryPipelineSource(
      { "/p": [file(CONFIG_FILENAME)] },
      { "/p": body },
    );
    await expect(src.loadConfig("/p")).resolves.toEqual(body);
  });

  it("throws when the listing advertises a config file but no body was registered", async () => {
    const src = new InMemoryPipelineSource({
      "/p": [file(CONFIG_FILENAME)],
    });
    await expect(src.loadConfig("/p")).rejects.toThrow(
      /config body missing/,
    );
  });

  it("listChildren returns the registered listing", async () => {
    const src = new InMemoryPipelineSource({ "/p": [dir("1__A"), file("x")] });
    const out = await src.listChildren("/p");
    expect(out.map((e) => e.name)).toEqual(["1__A", "x"]);
  });

  it("listChildren throws on unregistered paths so missing setup is loud", async () => {
    const src = new InMemoryPipelineSource({});
    await expect(src.listChildren("/missing")).rejects.toThrow(
      /no listing registered/,
    );
  });

  it("can serve a config without the file appearing in listings (lets tests skip plumbing)", async () => {
    // Tests sometimes only care about the config behavior; the listing
    // would normally include CONFIG_FILENAME but this fixture lets us
    // skip that.
    const body = { version: 1 };
    const src = new InMemoryPipelineSource(
      { "/p": [dir("1__A")] },
      { "/p": body },
    );
    await expect(src.loadConfig("/p")).resolves.toEqual(body);
    await expect(src.listChildren("/p")).resolves.toEqual([dir("1__A")]);
  });
});
