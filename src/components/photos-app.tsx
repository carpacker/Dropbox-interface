import {
  ChevronUp,
  Folder,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  defaultLocalRoot,
  imageSrc,
  isImageFile,
  listDirectory,
  parentDirectory,
  type FsEntry,
} from "@/lib/tauri-fs";

/**
 * How many image columns the thumbnail grid renders. Matches the Tailwind
 * `lg:grid-cols-5` breakpoint we hit on a typical desktop layout, and
 * drives the up/down arrow-key navigation step.
 */
const GRID_COLUMNS = 5;
/** Slideshow auto-advance interval in milliseconds. */
const SLIDESHOW_INTERVAL_MS = 2_200;

export function PhotosApp() {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);

  const loadPath = useCallback(async (path: string) => {
    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setIsSlideshowPlaying(false);
    try {
      const rows = await listDirectory(nextPath);
      setEntries(rows);
      setCurrentPath(nextPath);
      setPathInput(nextPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const root = await defaultLocalRoot();
        await loadPath(root);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [loadPath]);

  const folderEntries = useMemo(
    () => entries.filter((entry) => entry.isDirectory),
    [entries],
  );
  const imageEntries = useMemo(
    () => entries.filter((entry) => !entry.isDirectory && isImageFile(entry.path)),
    [entries],
  );

  async function handleGoUp() {
    if (!currentPath) {
      return;
    }
    const parent = await parentDirectory(currentPath);
    if (parent) {
      await loadPath(parent);
    }
  }

  const selectedIndex = useMemo(
    () =>
      selectedPath
        ? imageEntries.findIndex((entry) => entry.path === selectedPath)
        : -1,
    [imageEntries, selectedPath],
  );

  const advanceBy = useCallback(
    (delta: number) => {
      if (imageEntries.length === 0) return;
      const base = selectedIndex >= 0 ? selectedIndex : 0;
      const next = Math.max(
        0,
        Math.min(imageEntries.length - 1, base + delta),
      );
      setSelectedPath(imageEntries[next].path);
    },
    [imageEntries, selectedIndex],
  );

  const stopSlideshow = useCallback(() => setIsSlideshowPlaying(false), []);

  const toggleSlideshow = useCallback(() => {
    if (imageEntries.length === 0) return;
    if (selectedIndex < 0 && imageEntries[0]) {
      setSelectedPath(imageEntries[0].path);
    }
    setIsSlideshowPlaying((prev) => !prev);
  }, [imageEntries, selectedIndex]);

  // Keyboard navigation:
  //   Esc       — stop slideshow / close lightbox
  //   Space     — play/pause slideshow
  //   ← / →     — prev/next image
  //   ↑ / ↓     — prev/next *row* (uses GRID_COLUMNS)
  // Only active while the lightbox is open or a slideshow is playing.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === "Escape") {
        if (isSlideshowPlaying) {
          event.preventDefault();
          stopSlideshow();
        } else if (selectedPath) {
          setSelectedPath(null);
        }
        return;
      }

      if (event.key === " ") {
        if (imageEntries.length === 0) return;
        event.preventDefault();
        toggleSlideshow();
        return;
      }

      // Arrow keys only react when the lightbox is open and slideshow
      // isn't auto-driving the index; otherwise they'd fight the timer.
      if (!selectedPath || isSlideshowPlaying) return;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        advanceBy(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        advanceBy(-1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        advanceBy(GRID_COLUMNS);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        advanceBy(-GRID_COLUMNS);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    advanceBy,
    imageEntries.length,
    isSlideshowPlaying,
    selectedPath,
    stopSlideshow,
    toggleSlideshow,
  ]);

  // Slideshow timer. Advances `selectedPath` once per
  // SLIDESHOW_INTERVAL_MS, wrapping at the end. Stops automatically when
  // the user changes folders (loadPath clears isSlideshowPlaying).
  useEffect(() => {
    if (!isSlideshowPlaying || imageEntries.length === 0) return;
    const id = window.setInterval(() => {
      const current = selectedIndex >= 0 ? selectedIndex : 0;
      const next = (current + 1) % imageEntries.length;
      setSelectedPath(imageEntries[next].path);
    }, SLIDESHOW_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [imageEntries, isSlideshowPlaying, selectedIndex]);

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-2 pb-4">
        <CardTitle>Photo browser</CardTitle>
        <CardDescription>
          Browse local folders and preview common image formats. Click a
          thumbnail to open it.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault();
            void loadPath(pathInput);
          }}
        >
          <Input
            value={pathInput}
            onChange={(event) => setPathInput(event.currentTarget.value)}
            className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
            placeholder="Enter a folder path"
            aria-label="Photo folder path"
          />
          <div className="flex shrink-0 flex-row gap-2">
            <Button type="submit" disabled={loading}>
              Go
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={loading || !currentPath}
              onClick={() => void handleGoUp()}
              aria-label="Parent folder"
            >
              <ChevronUp data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={loading || !currentPath}
              onClick={() => void loadPath(currentPath)}
              aria-label="Refresh photo listing"
            >
              <RefreshCw data-icon="inline-start" />
            </Button>
          </div>
        </form>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        {folderEntries.length > 0 ? (
          <div
            className="flex flex-wrap gap-2"
            aria-label="Subfolders"
          >
            {folderEntries.map((entry) => (
              <Button
                key={entry.path}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadPath(entry.path)}
              >
                <Folder data-icon="inline-start" />
                <span className="max-w-[16ch] truncate">{entry.name}</span>
              </Button>
            ))}
          </div>
        ) : null}

        <Separator />

        {loading ? (
          <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : imageEntries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
            <ImageIcon data-icon="inline-start" />
            <p className="text-sm text-muted-foreground">
              No supported images in this folder.
            </p>
          </div>
        ) : (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6"
            aria-label="Image thumbnails"
          >
            {imageEntries.map((entry) => (
              <li key={entry.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(entry.path)}
                  className="group flex w-full flex-col gap-1.5 rounded-lg border bg-muted/20 p-2 text-left transition hover:border-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Open ${entry.name}`}
                >
                  <div className="aspect-square overflow-hidden rounded-md bg-muted">
                    <img
                      src={imageSrc(entry.path)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                    />
                  </div>
                  <span className="truncate text-xs font-medium" title={entry.name}>
                    {entry.name}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {selectedPath ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setSelectedPath(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
        >
          <div
            className="relative max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute right-2 top-2 z-10 flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={toggleSlideshow}
                aria-label={
                  isSlideshowPlaying ? "Pause slideshow" : "Play slideshow"
                }
                aria-pressed={isSlideshowPlaying ? "true" : "false"}
                title={
                  isSlideshowPlaying
                    ? "Pause slideshow (Space)"
                    : "Play slideshow (Space)"
                }
              >
                {isSlideshowPlaying ? (
                  <Pause data-icon="inline-start" />
                ) : (
                  <Play data-icon="inline-start" />
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setSelectedPath(null)}
                aria-label="Close preview"
              >
                <X data-icon="inline-start" />
              </Button>
            </div>
            <img
              src={imageSrc(selectedPath)}
              alt={selectedPath}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {selectedIndex >= 0
                ? `${selectedIndex + 1} / ${imageEntries.length}`
                : ""}
              <span className="ml-3">
                ← / → navigate · Space play/pause · Esc close
              </span>
            </p>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
