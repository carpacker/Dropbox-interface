/**
 * `PipelineOperator` implementation backed by the Dropbox API. Wraps the
 * existing `dropboxMove` / `dropboxCreateFolder` / `dropboxListFolder`
 * helpers behind the operator interface so `PipelineView` can stay
 * backend-agnostic.
 *
 * Lives outside `src/lib/pipeline/` for the same reason as the source
 * adapter: the pure pipeline lib should not import Dropbox glue.
 */

import { joinDropboxPath } from "@/lib/dropbox-pipeline-source";
import type { PipelineEntry } from "@/lib/pipeline/entry";
import type { PipelineOperator } from "@/lib/pipeline/operator";
import {
  dropboxCreateFolder,
  dropboxListFolder,
  dropboxMove,
} from "@/lib/tauri-dropbox";

export class DropboxPipelineOperator implements PipelineOperator {
  // DropboxEntry is structurally a PipelineEntry — the returns are
  // pass-through.

  move(fromPath: string, toPath: string): Promise<PipelineEntry> {
    return dropboxMove(fromPath, toPath);
  }

  createFolder(path: string): Promise<PipelineEntry> {
    return dropboxCreateFolder(path);
  }

  listChildren(parentPath: string): Promise<PipelineEntry[]> {
    return dropboxListFolder(parentPath);
  }

  joinPath(parent: string, child: string): string {
    return joinDropboxPath(parent, child);
  }
}
