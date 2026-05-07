import { File, Folder } from "lucide-react";

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
import type { FsEntry } from "@/lib/tauri-fs";
import { useDirectoryNav } from "@/lib/use-directory-nav";

export function FileBrowser() {
  const nav = useDirectoryNav();

  function handleOpenEntry(entry: FsEntry) {
    if (!entry.isDirectory) {
      return;
    }
    void nav.loadPath(entry.path);
  }

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-2 pb-4">
        <CardTitle>Local folders</CardTitle>
        <CardDescription>
          Browse directories on this machine via Tauri. Dropbox linking comes
          later alongside this view.
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
        />

        <Separator />

        <ScrollArea className="h-[min(55vh,520px)] rounded-lg border">
          <div className="flex flex-col gap-1 p-2">
            {nav.loading ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                Loading…
              </p>
            ) : nav.entries.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                This folder is empty.
              </p>
            ) : (
              nav.entries.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                  disabled={!entry.isDirectory}
                  onClick={() => handleOpenEntry(entry)}
                >
                  {entry.isDirectory ? (
                    <Folder data-icon="inline-start" />
                  ) : (
                    <File data-icon="inline-start" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
