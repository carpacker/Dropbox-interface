/**
 * `PipelineOperator` implementation backed by local FS via Tauri. Used by
 * `FileBrowser` when the navigated folder ships a `.dropbox-interface.json`
 * and the user is reviewing locally (e.g. staging before upload).
 *
 * **Threat-model note.** All paths originate from a directory the user
 * already chose via the file browser. The Rust commands reject empty
 * paths and refuse to clobber existing destinations. No new surface
 * beyond `local_move` / `local_create_folder` / `list_directory`.
 */

import { joinLocalPath } from "@/lib/local-pipeline-source";
import {
  fsEntryToPipelineEntry,
  type PipelineEntry,
} from "@/lib/pipeline/entry";
import type { PipelineOperator } from "@/lib/pipeline/operator";
import { createFolder, listDirectory, moveItem } from "@/lib/tauri-fs";

export class LocalPipelineOperator implements PipelineOperator {
  async move(fromPath: string, toPath: string): Promise<PipelineEntry> {
    const fs = await moveItem(fromPath, toPath);
    return fsEntryToPipelineEntry(fs);
  }

  async createFolder(path: string): Promise<PipelineEntry> {
    const fs = await createFolder(path);
    return fsEntryToPipelineEntry(fs);
  }

  async listChildren(parentPath: string): Promise<PipelineEntry[]> {
    const rows = await listDirectory(parentPath);
    return rows.map(fsEntryToPipelineEntry);
  }

  joinPath(parent: string, child: string): string {
    return joinLocalPath(parent, child);
  }
}
