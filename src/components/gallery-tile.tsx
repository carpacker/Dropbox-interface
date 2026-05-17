/**
 * Square thumbnail tile used by the pipeline gallery view. Mirrors the
 * shape of the list-mode `EntryRow` callbacks (preview, save, promote,
 * select, note, delete) so the same tile can stand in for any pipeline
 * row when the user toggles to gallery mode.
 *
 * Keeps Dropbox-specific calls behind a thumbnail-loader prop so the
 * component is testable without invoking Tauri. The default loader is
 * supplied by `dropbox-app` when the tile is rendered inside the Dropbox
 * pipeline view.
 */

import {
  ArrowRight,
  Download,
  File,
  Folder,
  ImageIcon,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { PipelineEntry } from "@/lib/pipeline/entry";
import { formatBytes } from "@/lib/sort";
import {
  isDropboxImage,
  type DropboxThumbnailSize,
} from "@/lib/tauri-dropbox";
import { cn } from "@/lib/utils";

/** Loader signature: same as `dropboxGetThumbnail`, lifted as a prop. */
export type ThumbnailLoader = (
  path: string,
  size: DropboxThumbnailSize,
) => Promise<string>;

export type GalleryTileProps = {
  entry: PipelineEntry;
  saving: boolean;
  loadThumbnail: ThumbnailLoader;
  onOpenFolder: (path: string) => void;
  onPreview: () => void;
  onSave: () => void;
  /** Promote affordance — when omitted, no promote button is rendered. */
  promote?: {
    targetStateName: string;
    inFlight: boolean;
    onClick: () => void;
  };
  /** Bulk-select state — only set inside the pipeline view. */
  select?: {
    selected: boolean;
    onToggle: () => void;
  };
  /** Local-only review note state. */
  note?: {
    hasNote: boolean;
    onClick: () => void;
  };
  /** Destructive delete — caller must wrap in a confirm modal. */
  delete?: {
    inFlight: boolean;
    onClick: () => void;
  };
  /**
   * Optional focus ring driver for keyboard navigation. The pipeline view
   * sets this to true on the focused tile and `data-focused` is mirrored
   * to the DOM so the active row is visible without stealing focus from
   * the panel-level handler.
   */
  focused?: boolean;
};

export function GalleryTile({
  entry,
  saving,
  loadThumbnail,
  onOpenFolder,
  onPreview,
  onSave,
  promote,
  select,
  note,
  delete: deleteAction,
  focused = false,
}: GalleryTileProps) {
  const isImage = isDropboxImage(entry);
  const isFolder = entry.kind === "folder";

  function handleMainClick() {
    if (isFolder) {
      onOpenFolder(entry.path);
    } else if (isImage) {
      onPreview();
    }
  }

  const mainDisabled = !isFolder && !isImage;

  return (
    <div
      data-focused={focused ? "true" : undefined}
      data-selected={select?.selected ? "true" : undefined}
      className={cn(
        "group relative flex flex-col gap-1.5 rounded-lg border bg-card p-2 transition",
        select?.selected && "ring-2 ring-foreground/40",
        focused && "ring-2 ring-foreground",
      )}
    >
      {select ? (
        <input
          type="checkbox"
          checked={select.selected}
          onChange={select.onToggle}
          aria-label={`Select ${entry.name}`}
          className="absolute left-2 top-2 z-10 h-4 w-4 cursor-pointer rounded bg-background/80"
        />
      ) : null}

      <button
        type="button"
        onClick={handleMainClick}
        disabled={mainDisabled}
        aria-label={
          isFolder
            ? `Open folder ${entry.name}`
            : isImage
              ? `Preview ${entry.name}`
              : entry.name
        }
        className={cn(
          "relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border bg-muted/40",
          !mainDisabled && "cursor-pointer hover:border-foreground/50",
          mainDisabled && "cursor-default",
        )}
      >
        <TileThumbnail entry={entry} isImage={isImage} loadThumbnail={loadThumbnail} />
      </button>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="truncate text-xs font-medium" title={entry.name}>
          {entry.name}
        </p>
        <p className="text-[10px] text-muted-foreground">
          {entry.size !== null && entry.size !== undefined
            ? formatBytes(entry.size)
            : isFolder
              ? "Folder"
              : "—"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-1">
        {promote ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={promote.inFlight}
            onClick={promote.onClick}
            aria-label={`Promote ${entry.name} to ${promote.targetStateName}`}
            title={
              promote.inFlight
                ? "Moving…"
                : `Promote to ${promote.targetStateName}`
            }
          >
            <ArrowRight data-icon="inline-start" />
          </Button>
        ) : null}
        {note ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={note.onClick}
            aria-label={
              note.hasNote
                ? `Edit note for ${entry.name}`
                : `Add note for ${entry.name}`
            }
            aria-pressed={note.hasNote ? "true" : "false"}
            title={note.hasNote ? "Edit note" : "Add note"}
            className="relative"
          >
            <MessageSquare data-icon="inline-start" />
            {note.hasNote ? (
              <span
                data-testid={`note-indicator-${entry.path}`}
                aria-hidden="true"
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-foreground"
              />
            ) : null}
          </Button>
        ) : null}
        {!isFolder ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={saving}
            onClick={onSave}
            aria-label={`Save ${entry.name} to disk`}
            title="Save to disk"
          >
            <Download data-icon="inline-start" />
          </Button>
        ) : null}
        {deleteAction ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={deleteAction.inFlight}
            onClick={deleteAction.onClick}
            aria-label={`Delete ${entry.name}`}
            className="text-destructive hover:bg-destructive/10"
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function TileThumbnail({
  entry,
  isImage,
  loadThumbnail,
}: {
  entry: PipelineEntry;
  isImage: boolean;
  loadThumbnail: ThumbnailLoader;
}) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    setThumb(null);
    setFailed(false);
    void (async () => {
      try {
        const url = await loadThumbnail(entry.path, "w256h256");
        if (!cancelled) setThumb(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.path, isImage, loadThumbnail]);

  if (entry.kind === "folder") {
    return <Folder className="size-10 text-muted-foreground" aria-hidden="true" />;
  }
  if (!isImage || failed) {
    return <File className="size-10 text-muted-foreground" aria-hidden="true" />;
  }
  if (!thumb) {
    return <ImageIcon className="size-10 text-muted-foreground" aria-hidden="true" />;
  }
  return (
    <img
      src={thumb}
      alt=""
      aria-hidden="true"
      data-testid={`gallery-thumbnail-${entry.path}`}
      className="h-full w-full object-cover"
    />
  );
}
