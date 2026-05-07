import {
  ChevronUp,
  Folder,
  ImageIcon,
  Pause,
  Play,
  RefreshCw,
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  defaultLocalRoot,
  listDirectory,
  parentDirectory,
  readImageDataUrl,
  type FsEntry,
} from "@/lib/tauri-fs";

const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
  ".svg",
  ".avif",
  ".ico",
  ".tif",
  ".tiff",
];
const GRID_COLUMNS = 4;
const MAX_THUMBNAILS_TO_PRELOAD = 48;
const SLIDESHOW_MS = 2200;

function isImageFile(path: string) {
  const lowered = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

export function PhotosApp() {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDataUrl, setSelectedDataUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [thumbnailUrls, setThumbnailUrls] = useState<Record<string, string>>({});
  const [thumbnailLoading, setThumbnailLoading] = useState<Record<string, boolean>>({});
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);

  const loadPath = useCallback(async (path: string) => {
    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setSelectedDataUrl(null);
    setThumbnailUrls({});
    setThumbnailLoading({});
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

  const imageEntries = useMemo(
    () => entries.filter((entry) => !entry.isDirectory && isImageFile(entry.path)),
    [entries],
  );

  const selectedIndex = useMemo(
    () => imageEntries.findIndex((entry) => entry.path === selectedPath),
    [imageEntries, selectedPath],
  );

  const loadThumbnail = useCallback(
    async (path: string) => {
      if (thumbnailUrls[path] || thumbnailLoading[path]) {
        return;
      }
      setThumbnailLoading((prev) => ({ ...prev, [path]: true }));
      try {
        const dataUrl = await readImageDataUrl(path);
        setThumbnailUrls((prev) => ({ ...prev, [path]: dataUrl }));
      } catch {
        /* ignore unsupported decoding for thumbs */
      } finally {
        setThumbnailLoading((prev) => ({ ...prev, [path]: false }));
      }
    },
    [thumbnailLoading, thumbnailUrls],
  );

  useEffect(() => {
    const preloadTargets = imageEntries.slice(0, MAX_THUMBNAILS_TO_PRELOAD);
    for (const image of preloadTargets) {
      void loadThumbnail(image.path);
    }
  }, [imageEntries, loadThumbnail]);

  async function openImage(path: string) {
    setPreviewLoading(true);
    setError(null);
    setSelectedPath(path);
    try {
      const dataUrl = await readImageDataUrl(path);
      setSelectedDataUrl(dataUrl);
    } catch (e) {
      setSelectedDataUrl(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  }

  function advanceBy(delta: number) {
    if (imageEntries.length === 0) {
      return;
    }
    const base = selectedIndex >= 0 ? selectedIndex : 0;
    const next = Math.max(0, Math.min(imageEntries.length - 1, base + delta));
    void openImage(imageEntries[next].path);
  }

  function stopSlideshow() {
    setIsSlideshowPlaying(false);
  }

  function toggleSlideshow() {
    if (imageEntries.length === 0) {
      return;
    }
    if (selectedIndex < 0) {
      void openImage(imageEntries[0].path);
    }
    setIsSlideshowPlaying((prev) => !prev);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        return;
      }
      if (event.key === "Escape") {
        if (isSlideshowPlaying) {
          event.preventDefault();
          stopSlideshow();
        }
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        toggleSlideshow();
        return;
      }
      if (imageEntries.length === 0 || isSlideshowPlaying) {
        return;
      }

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

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageEntries, isSlideshowPlaying, selectedIndex]);

  useEffect(() => {
    if (!isSlideshowPlaying || imageEntries.length === 0) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = selectedIndex >= 0 ? selectedIndex : 0;
      const next = (current + 1) % imageEntries.length;
      void openImage(imageEntries[next].path);
    }, SLIDESHOW_MS);
    return () => window.clearInterval(timer);
  }, [imageEntries, isSlideshowPlaying, selectedIndex]);

  async function handleGoUp() {
    if (!currentPath) {
      return;
    }
    const parent = await parentDirectory(currentPath);
    if (parent) {
      await loadPath(parent);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,380px),minmax(0,1fr)]">
      <Card className="flex flex-col gap-0 overflow-hidden">
        <CardHeader className="flex flex-col gap-2 pb-4">
          <CardTitle>Photo browser</CardTitle>
          <CardDescription>
            Browse local folders and preview supported formats:
            jpg/jpeg/png/gif/webp/bmp/svg/avif/ico/tif/tiff.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-0">
          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void loadPath(pathInput);
            }}
          >
            <Input
              value={pathInput}
              onChange={(event) => setPathInput(event.currentTarget.value)}
              className="font-mono text-xs sm:text-sm"
              placeholder="Enter a folder path"
              aria-label="Photo folder path"
            />
            <div className="flex flex-row gap-2">
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
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Separator />

          <ScrollArea className="h-[min(60vh,560px)] rounded-lg border">
            <div className="flex flex-col gap-1 p-2">
              {loading ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {entries.filter((entry) => entry.isDirectory).map((entry) => (
                    <Button
                      key={entry.path}
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      onClick={() => void loadPath(entry.path)}
                    >
                      <Folder data-icon="inline-start" />
                      <span className="truncate">{entry.name}</span>
                    </Button>
                  ))}
                  {!entries.some((entry) => entry.isDirectory) && imageEntries.length === 0 ? (
                    <p className="px-2 py-6 text-sm text-muted-foreground">
                      No folders or supported images here.
                    </p>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="flex flex-col gap-0 overflow-hidden">
        <CardHeader className="flex flex-col gap-2 pb-4">
          <CardTitle>Preview</CardTitle>
          <CardDescription>
            {selectedPath ? selectedPath : "Choose an image file to preview"}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="mb-3 rounded-lg border p-2">
            <ScrollArea className="h-[min(26vh,220px)]">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {imageEntries.map((entry) => {
                  const thumb = thumbnailUrls[entry.path];
                  const isSelected = selectedPath === entry.path;
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      className={`rounded-lg border p-1 text-left transition ${
                        isSelected
                          ? "border-primary bg-primary/10"
                          : "hover:bg-muted/60"
                      }`}
                      onClick={() => void openImage(entry.path)}
                    >
                      <div className="mb-1 flex h-20 items-center justify-center overflow-hidden rounded bg-muted/40">
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={entry.name}
                            className="size-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-xs text-muted-foreground">
                            <ImageIcon />
                            <span>
                              {thumbnailLoading[entry.path] ? "Loading…" : "Preview"}
                            </span>
                          </div>
                        )}
                      </div>
                      <p className="truncate text-xs">{entry.name}</p>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
            <p className="mt-2 text-xs text-muted-foreground">
              Keyboard: Arrow keys navigate, Space play/pause slideshow, Esc stop.
            </p>
          </div>
          <div className="mb-3 flex items-center gap-2">
            <Button
              type="button"
              disabled={imageEntries.length === 0}
              onClick={toggleSlideshow}
            >
              {isSlideshowPlaying ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
              {isSlideshowPlaying ? "Pause slideshow" : "Start slideshow"}
            </Button>
            {isSlideshowPlaying ? (
              <p className="text-xs text-muted-foreground">
                Playing every {Math.round(SLIDESHOW_MS / 1000)}s
              </p>
            ) : null}
          </div>
          <div className="flex min-h-[min(46vh,420px)] items-center justify-center rounded-lg border bg-muted/20 p-3">
            {previewLoading ? (
              <p className="text-sm text-muted-foreground">Loading image…</p>
            ) : selectedDataUrl ? (
              <img
                src={selectedDataUrl}
                alt="Selected local file"
                className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                Select an image from the left panel.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
