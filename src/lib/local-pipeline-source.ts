/**
 * Local-filesystem implementation of `PipelineSource`. Lets the existing
 * `FileBrowser` (and the pipeline UI in a follow-up round) host pipelines
 * defined on local disk — useful for staging a folder structure before
 * it goes up to Dropbox, or for working offline.
 *
 * Lives outside `src/lib/pipeline/` on purpose, mirroring
 * `dropbox-pipeline-source.ts`: that directory is a pure, backend-
 * agnostic library; FS-specific glue is concentrated here.
 *
 * **Threat-model note.** All filesystem access goes through the existing
 * `list_directory` / `local_read_text_file` Rust commands, whose paths
 * the user already controls via the file browser. No new attack surface.
 */

import { CONFIG_FILENAME, type EntryHandle } from "@/lib/pipeline/pipeline";
import type { PipelineSource } from "@/lib/pipeline/source";
import { listDirectory, readTextFile } from "@/lib/tauri-fs";

export class LocalPipelineSource implements PipelineSource {
  async loadConfig(parentPath: string): Promise<unknown | null> {
    const configPath = joinLocalPath(parentPath, CONFIG_FILENAME);
    const text = await readTextFile(configPath);
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
    const entries = await listDirectory(parentPath);
    return entries.map((e) => ({
      name: e.name,
      path: e.path,
      isDirectory: e.isDirectory,
    }));
  }
}

/**
 * Build a local filesystem path by joining `parent` with `child`.
 * Picks the separator based on whether the parent looks Windows-style
 * (drive-letter prefix or contains a backslash) so the result stays
 * consistent with whatever convention the host OS already used in
 * `parent`.
 *
 * Uses string-level joining rather than `path.posix.join` / a node-only
 * helper so it works the same way under the Tauri renderer (no Node).
 */
export function joinLocalPath(parent: string, child: string): string {
  if (parent === "") return child;
  const isWindowsStyle =
    /^[A-Za-z]:[\\/]/.test(parent) || parent.includes("\\");
  const sep = isWindowsStyle ? "\\" : "/";
  // Strip a single trailing separator (either flavor) so we don't end
  // up with `C:\foo\\.config` or `/foo//.config`.
  const trimmed = parent.replace(/[/\\]+$/, "");
  return `${trimmed}${sep}${child}`;
}
