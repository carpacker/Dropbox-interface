import { ChevronUp, File, Folder, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterChip } from "@/components/filter-chip";
import { SortDropdown } from "@/components/sort-dropdown";
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
import { filterByQuery } from "@/lib/filter";
import {
  formatBytes,
  loadSortPreference,
  saveSortPreference,
  sortEntries,
  type SortPreference,
} from "@/lib/sort";
import {
  defaultLocalRoot,
  listDirectory,
  parentDirectory,
  type FsEntry,
} from "@/lib/tauri-fs";
import { formatRelativeTime } from "@/lib/time-format";

export function FileBrowser() {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortPreference>(() => loadSortPreference());
  const [filter, setFilter] = useState("");

  const loadPath = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    // Filter is per-listing; clear it when the listing changes so the
    // user doesn't see "no matches" against a stale query.
    setFilter("");
    try {
      const rows = await listDirectory(path);
      setCurrentPath(path);
      setPathInput(path);
      setEntries(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const root = await defaultLocalRoot();
        if (!cancelled) {
          await loadPath(root);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadPath]);

  // Sort first, then filter — keeping the visible order consistent
  // with the global sort preference.
  const visibleEntries = useMemo(() => {
    const sorted = sortEntries(entries, sort);
    return filterByQuery(sorted, filter);
  }, [entries, sort, filter]);

  function updateSort(next: SortPreference) {
    setSort(next);
    saveSortPreference(next);
  }

  async function handleGoUp() {
    if (!currentPath) {
      return;
    }
    try {
      const parent = await parentDirectory(currentPath);
      if (parent) {
        await loadPath(parent);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleSubmitPath(event: React.FormEvent) {
    event.preventDefault();
    await loadPath(pathInput.trim());
  }

  async function handleOpenEntry(entry: FsEntry) {
    if (!entry.isDirectory) {
      return;
    }
    await loadPath(entry.path);
  }

  // Snapshot Date.now() once per render so every row's relative-time
  // label uses the same reference point.
  const nowMs = Date.now();

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
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={handleSubmitPath}
        >
          <Input
            value={pathInput}
            onChange={(e) => setPathInput(e.currentTarget.value)}
            placeholder="Enter a folder path"
            aria-label="Folder path"
            className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
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
              aria-label="Refresh listing"
            >
              <RefreshCw data-icon="inline-start" />
            </Button>
          </div>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {filter.trim() !== ""
              ? `${visibleEntries.length} of ${entries.length}`
              : entries.length === 0
                ? "Empty"
                : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
          </p>
          <div className="flex items-center gap-2">
            <FilterChip
              value={filter}
              onChange={setFilter}
              label="Filter folders"
              placeholder="Filter…"
            />
            <SortDropdown value={sort} onChange={updateSort} compact />
          </div>
        </div>

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Separator />

        <ScrollArea className="h-[min(55vh,520px)] rounded-lg border">
          <div className="flex flex-col gap-1 p-2">
            {loading ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                Loading…
              </p>
            ) : visibleEntries.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                {filter.trim() !== ""
                  ? `No items match “${filter.trim()}”.`
                  : "This folder is empty."}
              </p>
            ) : (
              visibleEntries.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                  disabled={!entry.isDirectory}
                  onClick={() => void handleOpenEntry(entry)}
                >
                  {entry.isDirectory ? (
                    <Folder data-icon="inline-start" />
                  ) : (
                    <File data-icon="inline-start" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">
                    {entry.name}
                  </span>
                  {entry.size !== null && entry.size !== undefined ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatBytes(entry.size)}
                    </span>
                  ) : null}
                  {entry.modified !== null && entry.modified !== undefined ? (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(entry.modified * 1000, nowMs)}
                    </span>
                  ) : null}
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
