import { ChevronUp, Folder, ImageIcon, RefreshCw, X } from "lucide-react";
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

export function PhotosApp() {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const loadPath = useCallback(async (path: string) => {
    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedPath(null);
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

  useEffect(() => {
    if (!selectedPath) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedPath(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPath]);

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
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setSelectedPath(null)}
              className="absolute right-2 top-2 z-10"
              aria-label="Close preview"
            >
              <X data-icon="inline-start" />
            </Button>
            <img
              src={imageSrc(selectedPath)}
              alt={selectedPath}
              className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
            />
          </div>
        </div>
      ) : null}
    </Card>
  );
}
