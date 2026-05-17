/**
 * Generic tile for browser listings (FileBrowser flat view, Dropbox flat
 * view). Mirrors the pattern of `GalleryTile` (used inside pipelines)
 * but stays standalone — no pipeline-specific affordances (Promote,
 * note indicators, multi-select), just the common "click to open" verb.
 *
 * Three visual variants:
 *   - folder → big tinted folder icon, click → onOpenFolder
 *   - image  → square thumbnail, click → onPreview (lazy loaded via
 *              an injected loader so this works for local and Dropbox)
 *   - file   → big tinted file icon with the extension stamped beneath
 *
 * The thumbnail loader is a prop so the same tile lights up a local
 * image (via `convertFileSrc`) or a Dropbox image (via
 * `dropbox_get_thumbnail`) without the tile knowing about either.
 */

import { File, Folder, ImageIcon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { PipelineEntry } from "@/lib/pipeline/entry";
import { formatBytes } from "@/lib/sort";
import { cn } from "@/lib/utils";

/**
 * Loader signature: resolves to a renderable `<img src=…>` value for
 * this entry, or rejects when the backend can't supply a thumbnail.
 * Synchronous loaders are fine (e.g. local-FS adapters that just wrap
 * `convertFileSrc` and don't need an `await`).
 */
export type ThumbnailLoader = (entry: PipelineEntry) => Promise<string>;

export type BrowserTileProps = {
  entry: PipelineEntry;
  /** When the entry's name extension says it's an image. */
  isImage: boolean;
  /** Resolves the entry's thumbnail src; only called when isImage. */
  loadThumbnail: ThumbnailLoader;
  onOpenFolder: (path: string) => void;
  onPreview: () => void;
  /**
   * Tail-end slot (right-aligned icons row at the bottom). Used by
   * surfaces that want to attach per-row actions (Save, Delete) to a
   * tile without forking the component.
   */
  actions?: ReactNode;
};

export function BrowserTile({
  entry,
  isImage,
  loadThumbnail,
  onOpenFolder,
  onPreview,
  actions,
}: BrowserTileProps) {
  const isFolder = entry.kind === "folder";

  function handleMainClick() {
    if (isFolder) onOpenFolder(entry.path);
    else if (isImage) onPreview();
  }

  const mainDisabled = !isFolder && !isImage;

  return (
    <div className="group flex flex-col gap-2 rounded-xl border bg-card p-3 transition hover:border-foreground/40 hover:shadow-sm">
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
          "relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg",
          !mainDisabled && "cursor-pointer",
          isFolder && "bg-muted/40",
          // Image tiles: dim background, the thumb fills.
          isImage && "bg-muted/40",
          // Plain-file tiles: subtle bg, big icon.
          !isFolder && !isImage && "bg-muted/30",
          mainDisabled && "cursor-default",
        )}
      >
        <TileGlyph
          entry={entry}
          isImage={isImage}
          loadThumbnail={loadThumbnail}
        />
        {/* Extension chip on plain files so the tile communicates
           type at-a-glance even when nothing previews. */}
        {!isFolder && !isImage ? (
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          >
            {extOf(entry.name)}
          </span>
        ) : null}
      </button>

      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className="line-clamp-2 break-words text-sm font-medium leading-tight"
          title={entry.name}
        >
          {entry.name}
        </p>
        <p className="text-xs text-muted-foreground">
          {entry.size !== null && entry.size !== undefined
            ? formatBytes(entry.size)
            : isFolder
              ? "Folder"
              : "—"}
        </p>
      </div>

      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-1">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function TileGlyph({
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
        const url = await loadThumbnail(entry);
        if (!cancelled) setThumb(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, isImage, loadThumbnail]);

  if (entry.kind === "folder") {
    return (
      <Folder
        className="size-14 text-foreground/70 transition group-hover:text-foreground"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }
  if (!isImage || failed) {
    return (
      <File
        className="size-12 text-foreground/60"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }
  if (!thumb) {
    return (
      <ImageIcon
        className="size-12 text-foreground/40"
        strokeWidth={1.5}
        aria-hidden="true"
      />
    );
  }
  return (
    <img
      src={thumb}
      alt=""
      aria-hidden="true"
      data-testid={`browser-thumbnail-${entry.path}`}
      className="h-full w-full object-cover"
    />
  );
}

/** Uppercase extension for the file-type chip; "FILE" when there isn't one. */
function extOf(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return "FILE";
  return name.slice(idx + 1).toUpperCase().slice(0, 5);
}

/**
 * Reusable button slot for tile actions. Surfaces wrap it so they don't
 * duplicate the styling (variant=outline, size=icon).
 */
export function BrowserTileAction({
  ariaLabel,
  title,
  onClick,
  disabled,
  children,
}: {
  ariaLabel: string;
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </Button>
  );
}
