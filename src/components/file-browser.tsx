import {
  ChevronUp,
  File,
  Folder,
  LayoutGrid,
  List,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BrowserTile } from "@/components/browser-tile";
import { FilterChip } from "@/components/filter-chip";
import { LocalEntryRow } from "@/components/local-entry-row";
import { PipelineView } from "@/components/pipeline-view";
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
import { ViewModeToggle } from "@/components/view-mode-toggle";
import {
  getBrowserViewMode,
  setBrowserViewMode,
  type BrowserViewMode,
} from "@/lib/browser-view-mode";
import { filterByQuery } from "@/lib/filter";
import { LocalPipelineOperator } from "@/lib/local-pipeline-operator";
import { LocalPipelineSource } from "@/lib/local-pipeline-source";
import { fsEntryToPipelineEntry } from "@/lib/pipeline/entry";
import {
  parseConfig,
  type ConfigIssue,
  type PipelineConfig,
} from "@/lib/pipeline/schema";
import {
  formatBytes,
  loadSortPreference,
  saveSortPreference,
  sortEntries,
  type SortPreference,
} from "@/lib/sort";
import {
  defaultLocalRoot,
  imageSrc,
  isImageFile,
  listDirectory,
  parentDirectory,
  type FsEntry,
} from "@/lib/tauri-fs";
import { formatRelativeTime } from "@/lib/time-format";

/** Storage key used by `browser-view-mode` for the local file browser. */
const FILES_BROWSER_ID = "files";

export function FileBrowser() {
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortPreference>(() => loadSortPreference());
  const [filter, setFilter] = useState("");
  const [viewMode, setViewModeState] = useState<BrowserViewMode>(() =>
    getBrowserViewMode(FILES_BROWSER_ID),
  );
  function updateViewMode(next: BrowserViewMode) {
    setViewModeState(next);
    setBrowserViewMode(FILES_BROWSER_ID, next);
  }

  // Pipeline detection mirrors `DropboxApp`: each navigation parallel-
  // fetches both the listing and the config. A valid config switches
  // the body to `PipelineView`; an invalid config shows an inline
  // banner and falls back to the flat browser.
  const [pipelineConfig, setPipelineConfig] = useState<PipelineConfig | null>(
    null,
  );
  const [pipelineIssues, setPipelineIssues] = useState<ConfigIssue[] | null>(
    null,
  );
  // Stable adapter instances. Both are pure — no per-pipeline state.
  const [pipelineSource] = useState(() => new LocalPipelineSource());
  const [pipelineOperator] = useState(() => new LocalPipelineOperator());

  const loadPath = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      // Reset pipeline detection on each navigation; we'll re-evaluate
      // against the new path's listing.
      setPipelineConfig(null);
      setPipelineIssues(null);
      // Filter is per-listing; clear it when the listing changes so the
      // user doesn't see "no matches" against a stale query.
      setFilter("");
      try {
        const [rows, rawConfig] = await Promise.all([
          listDirectory(path),
          // A failed config read shouldn't block the browse; swallow it
          // and the user just sees the flat view.
          pipelineSource.loadConfig(path).catch(() => null),
        ]);
        setCurrentPath(path);
        setPathInput(path);
        setEntries(rows);
        if (rawConfig != null) {
          const parsed = parseConfig(rawConfig);
          if (parsed.ok) {
            setPipelineConfig(parsed.config);
          } else {
            setPipelineIssues(parsed.issues);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [pipelineSource],
  );

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
          Browse directories on this machine. Folders carrying a
          <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
            .dropbox-interface.json
          </code>
          switch to the pipeline view automatically.
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
            <ViewModeToggle<BrowserViewMode>
              value={viewMode}
              onChange={updateViewMode}
              options={[
                { value: "list", icon: List, label: "List" },
                { value: "tile", icon: LayoutGrid, label: "Tile" },
              ]}
            />
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

        {pipelineIssues ? (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-300"
          >
            <p className="font-medium">
              .dropbox-interface.json is invalid; falling back to flat view.
            </p>
            <ul className="list-disc pl-5 text-xs">
              {pipelineIssues.slice(0, 5).map((issue, i) => (
                <li key={`${issue.path}-${i}`}>
                  <code>{issue.path || "(root)"}</code>: {issue.message}
                </li>
              ))}
              {pipelineIssues.length > 5 ? (
                <li>…and {pipelineIssues.length - 5} more.</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <Separator />

        {pipelineConfig ? (
          <PipelineView
            parentPath={currentPath}
            config={pipelineConfig}
            operator={pipelineOperator}
            parentEntries={entries.map(fsEntryToPipelineEntry)}
            onNavigateInto={(p) => void loadPath(p)}
            onParentRefresh={() => void loadPath(currentPath)}
            // No image preview on local pipelines yet — Photos app
            // covers that surface. Wire to a noop so PipelineView's
            // Enter-on-image gesture is just inert here.
            onPreviewImage={() => {}}
            onSaveFile={() => {}}
            savingPath={null}
            renderEntryRow={(entry, opts) => (
              <LocalEntryRow
                entry={entry}
                onOpenFolder={opts.onOpenFolder}
                promote={opts.promote}
                select={opts.select}
                note={opts.note}
              />
            )}
          />
        ) : (
          <ScrollArea
            className={
              viewMode === "tile"
                ? "h-[min(70vh,640px)] rounded-lg border"
                : "h-[min(55vh,520px)] rounded-lg border"
            }
          >
            {loading ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                Loading…
              </p>
            ) : visibleEntries.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">
                {filter.trim() !== ""
                  ? `No items match “${filter.trim()}”.`
                  : "This folder is empty."}
              </p>
            ) : viewMode === "tile" ? (
              <ul className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                {visibleEntries.map((entry) => (
                  <li key={entry.path}>
                    <BrowserTile
                      entry={fsEntryToPipelineEntry(entry)}
                      isImage={!entry.isDirectory && isImageFile(entry.path)}
                      loadThumbnail={async (e) => imageSrc(e.path)}
                      onOpenFolder={(p) => void loadPath(p)}
                      // Local files don't have an inline preview in
                      // the file browser today (the Photos app
                      // surfaces that). Click-to-preview is wired so
                      // the tile component stays generic; this
                      // currently no-ops, matching the row's
                      // "disabled for non-folders" behavior.
                      onPreview={() => {}}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-0.5 p-1.5">
                {visibleEntries.map((entry) => (
                  <Button
                    key={entry.path}
                    type="button"
                    variant="ghost"
                    className="h-auto w-full justify-start gap-2.5 rounded-md px-3 py-2 font-normal"
                    disabled={!entry.isDirectory}
                    onClick={() => void handleOpenEntry(entry)}
                  >
                    {entry.isDirectory ? (
                      <Folder
                        data-icon="inline-start"
                        className="text-foreground/70"
                      />
                    ) : (
                      <File
                        data-icon="inline-start"
                        className="text-foreground/50"
                      />
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
                ))}
              </div>
            )}
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
