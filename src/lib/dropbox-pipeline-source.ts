/**
 * Dropbox-backed implementation of `PipelineSource`.
 *
 * Lives outside `src/lib/pipeline/` on purpose — that directory is a pure,
 * backend-agnostic library. Dropbox-specific glue (the path conventions,
 * the JSON.parse step, error mapping) is concentrated here.
 */

import { CONFIG_FILENAME, type EntryHandle } from "@/lib/pipeline/pipeline";
import type { PipelineSource } from "@/lib/pipeline/source";
import { dropboxListFolder, dropboxReadTextFile } from "@/lib/tauri-dropbox";

export class DropboxPipelineSource implements PipelineSource {
  async loadConfig(parentPath: string): Promise<unknown | null> {
    const configPath = joinDropboxPath(parentPath, CONFIG_FILENAME);
    const text = await dropboxReadTextFile(configPath);
    if (text === null) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new Error(
        `pipeline config at ${configPath} is not valid JSON: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  async listChildren(parentPath: string): Promise<EntryHandle[]> {
    // Dropbox uses "" for the root path and rejects "/".
    const dropboxPath = parentPath === "/" ? "" : parentPath;
    const entries = await dropboxListFolder(dropboxPath);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.kind === "folder",
    }));
  }
}

/**
 * Build a Dropbox path by joining `parent` with `child`. Handles the root
 * case (empty / "/") and avoids accidental double slashes when the parent
 * path is already trailing-slashed.
 */
export function joinDropboxPath(parent: string, child: string): string {
  if (parent === "" || parent === "/") {
    return `/${child}`;
  }
  return `${parent.replace(/\/+$/, "")}/${child}`;
}
