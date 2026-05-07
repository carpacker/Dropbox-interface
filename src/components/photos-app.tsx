import { ChevronUp, Folder, ImageIcon, RefreshCw } from "lucide-react";
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

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

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

  const loadPath = useCallback(async (path: string) => {
    const nextPath = path.trim();
    if (!nextPath) {
      return;
    }
    setLoading(true);
    setError(null);
    setSelectedPath(null);
    setSelectedDataUrl(null);
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
            Browse local folders and preview common image formats.
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
                  {imageEntries.map((entry) => (
                    <Button
                      key={entry.path}
                      type="button"
                      variant={selectedPath === entry.path ? "secondary" : "ghost"}
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      onClick={() => void openImage(entry.path)}
                    >
                      <ImageIcon data-icon="inline-start" />
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
          <div className="flex min-h-[min(60vh,560px)] items-center justify-center rounded-lg border bg-muted/20 p-3">
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
