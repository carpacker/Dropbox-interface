import { Folder, ImageIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { DirectoryToolbar } from "@/components/directory-toolbar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { readImageDataUrl } from "@/lib/tauri-fs";
import { useDirectoryNav } from "@/lib/use-directory-nav";

const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

function isImageFile(path: string) {
  const lowered = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

export function PhotosApp() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDataUrl, setSelectedDataUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const clearSelection = useCallback(() => {
    setSelectedPath(null);
    setSelectedDataUrl(null);
  }, []);

  const nav = useDirectoryNav({ onBeforeLoad: clearSelection });

  const imageEntries = useMemo(
    () => nav.entries.filter((entry) => !entry.isDirectory && isImageFile(entry.path)),
    [nav.entries],
  );

  const folderEntries = useMemo(
    () => nav.entries.filter((entry) => entry.isDirectory),
    [nav.entries],
  );

  async function openImage(path: string) {
    setPreviewLoading(true);
    nav.setError(null);
    setSelectedPath(path);
    try {
      const dataUrl = await readImageDataUrl(path);
      setSelectedDataUrl(dataUrl);
    } catch (e) {
      setSelectedDataUrl(null);
      nav.setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
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
          <DirectoryToolbar
            pathInput={nav.pathInput}
            onPathInputChange={nav.setPathInput}
            onSubmit={() => void nav.submitPath()}
            onGoUp={() => void nav.goUp()}
            onRefresh={() => void nav.refresh()}
            loading={nav.loading}
            hasPath={!!nav.currentPath}
            error={nav.error}
            inputAriaLabel="Photo folder path"
            refreshAriaLabel="Refresh photo listing"
          />

          <Separator />

          <ScrollArea className="h-[min(60vh,560px)] rounded-lg border">
            <div className="flex flex-col gap-1 p-2">
              {nav.loading ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {folderEntries.map((entry) => (
                    <Button
                      key={entry.path}
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      onClick={() => void nav.loadPath(entry.path)}
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
                  {folderEntries.length === 0 && imageEntries.length === 0 ? (
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
