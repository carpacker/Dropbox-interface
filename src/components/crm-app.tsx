/**
 * CRM app. Reads a CSV from a user-chosen local folder
 * (`<root>/contacts.csv`), renders a sortable/filterable table, and
 * surfaces per-row "pertinent files" from `<root>/files/<rowKey>/`.
 *
 * Read-only for v1. Writes (add/edit/delete rows, drop files into
 * the sidecar) come in a follow-up so the registry + read path can
 * settle first.
 *
 * Threat-model footprint: identical to FileBrowser. Uses the same
 * `list_directory`, `local_read_text_file`, and asset-protocol image
 * surface that already ship. No new commands, no new scopes.
 */

import { open } from "@tauri-apps/plugin-dialog";
import {
  ChevronRight,
  File,
  FolderOpen,
  ImageIcon,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { FilterChip } from "@/components/filter-chip";
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
import type { AppDescriptor } from "@/lib/apps/types";
import {
  csvPathFor,
  filesDirFor,
  loadCrmConfig,
  saveCrmConfig,
} from "@/lib/crm-config";
import { pickKeyColumn, rowKeyFor } from "@/lib/crm-row-key";
import { parseCsv, type CsvParseError, type CsvRow } from "@/lib/csv";
import {
  imageSrc,
  isImageFile,
  listDirectory,
  readTextFile,
  type FsEntry,
} from "@/lib/tauri-fs";

/** Bytes cap for the CSV read. Larger than the pipeline config cap. */
const CSV_MAX_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Stream state for the CRM body. Each transition is a single setState
 * so the UI can render an unambiguous status without combining
 * multiple flags.
 */
type CrmStatus =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | {
      kind: "ready";
      rootPath: string;
      headers: string[];
      rows: CsvRow[];
      keyColumn: string | null;
    }
  | {
      kind: "parse-error";
      rootPath: string;
      errors: CsvParseError[];
    }
  | { kind: "error"; message: string };

export function CrmApp() {
  const [status, setStatus] = useState<CrmStatus>({ kind: "unconfigured" });
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Initial mount: try to load whatever root the user previously
  // configured. Unconfigured = show the setup card.
  useEffect(() => {
    const cfg = loadCrmConfig();
    if (cfg.rootPath) void load(cfg.rootPath);
  }, []);

  const load = useCallback(async (rootPath: string) => {
    setStatus({ kind: "loading" });
    setSelectedKey(null);
    setFilter("");
    try {
      const csvPath = csvPathFor(rootPath);
      const text = await readTextFile(csvPath, CSV_MAX_BYTES);
      if (text === null) {
        setStatus({
          kind: "error",
          message: `No contacts.csv at ${csvPath}. Pick a folder containing one or create the file.`,
        });
        return;
      }
      const parsed = parseCsv(text);
      if (!parsed.ok) {
        setStatus({ kind: "parse-error", rootPath, errors: parsed.errors });
        return;
      }
      const keyColumn = pickKeyColumn(parsed.headers);
      // Default sort key to the chosen key column so the table opens
      // ordered by what the user thinks of as "the name column".
      setSortKey(keyColumn);
      setStatus({
        kind: "ready",
        rootPath,
        headers: parsed.headers,
        rows: parsed.rows,
        keyColumn,
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  async function handlePickRoot() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      saveCrmConfig({ rootPath: picked });
      await load(picked);
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (status.kind === "unconfigured") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle className="flex items-center gap-2">
            <Users />
            CRM
          </CardTitle>
          <CardDescription>
            Pick a folder that contains
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              contacts.csv
            </code>
            and (optionally) a
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              files/
            </code>
            subfolder with per-row attachments at
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              files/&lt;rowKey&gt;/
            </code>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => void handlePickRoot()}>
            <FolderOpen data-icon="inline-start" />
            Pick CRM folder
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status.kind === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>CRM</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status.kind === "error") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>CRM</CardTitle>
          <CardDescription>Something went wrong.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {status.message}
          </p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void handlePickRoot()}>
              <FolderOpen data-icon="inline-start" />
              Pick a different folder
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status.kind === "parse-error") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>CRM</CardTitle>
          <CardDescription>
            Could not parse <code>contacts.csv</code> at <code>{status.rootPath}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ul className="list-disc rounded-lg border border-amber-500/40 bg-amber-500/10 px-5 py-2 text-sm text-amber-900 dark:text-amber-300">
            {status.errors.slice(0, 10).map((e, i) => (
              <li key={`${e.line}-${i}`}>
                Line {e.line}: {e.message}
              </li>
            ))}
            {status.errors.length > 10 ? (
              <li>…and {status.errors.length - 10} more.</li>
            ) : null}
          </ul>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => void load(status.rootPath)}
            >
              <RefreshCw data-icon="inline-start" />
              Reload
            </Button>
            <Button type="button" onClick={() => void handlePickRoot()}>
              <FolderOpen data-icon="inline-start" />
              Pick a different folder
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // kind === "ready"
  return (
    <CrmTable
      rootPath={status.rootPath}
      headers={status.headers}
      rows={status.rows}
      keyColumn={status.keyColumn}
      filter={filter}
      onFilterChange={setFilter}
      sortKey={sortKey}
      sortDir={sortDir}
      onSortChange={(key, dir) => {
        setSortKey(key);
        setSortDir(dir);
      }}
      selectedKey={selectedKey}
      onSelect={setSelectedKey}
      onReload={() => void load(status.rootPath)}
      onPickDifferent={() => void handlePickRoot()}
    />
  );
}

type CrmTableProps = {
  rootPath: string;
  headers: string[];
  rows: CsvRow[];
  keyColumn: string | null;
  filter: string;
  onFilterChange: (next: string) => void;
  sortKey: string | null;
  sortDir: "asc" | "desc";
  onSortChange: (key: string, dir: "asc" | "desc") => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onReload: () => void;
  onPickDifferent: () => void;
};

function CrmTable({
  rootPath,
  headers,
  rows,
  keyColumn,
  filter,
  onFilterChange,
  sortKey,
  sortDir,
  onSortChange,
  selectedKey,
  onSelect,
  onReload,
  onPickDifferent,
}: CrmTableProps) {
  // Snapshot per-row key once so the table render + sidebar lookup
  // agree (rows without a sane key are dropped from the rendered list).
  const keyedRows = useMemo(() => {
    if (!keyColumn) return [];
    const out: Array<{ key: string; row: CsvRow }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const k = rowKeyFor(row, keyColumn);
      if (!k) continue;
      // De-dupe defensively: two rows resolving to the same key would
      // confuse the per-row files lookup.
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, row });
    }
    return out;
  }, [rows, keyColumn]);

  const filtered = useMemo(() => {
    const q = filter.trim();
    if (q === "") return keyedRows;
    // Search across all visible cell values for the row.
    const tokens = q.toLowerCase().split(/\s+/);
    return keyedRows.filter(({ row }) => {
      const haystack = headers
        .map((h) => row[h] ?? "")
        .join("  ")
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [keyedRows, filter, headers]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = (a.row[sortKey] ?? "").toLowerCase();
      const bv = (b.row[sortKey] ?? "").toLowerCase();
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleSort(col: string) {
    if (col === sortKey) {
      onSortChange(col, sortDir === "asc" ? "desc" : "asc");
    } else {
      onSortChange(col, "asc");
    }
  }

  // Selected row resolves to a stable record from `keyedRows` so the
  // detail drawer keeps rendering even when the table re-filters.
  const selected = useMemo(
    () =>
      selectedKey
        ? keyedRows.find((r) => r.key === selectedKey) ?? null
        : null,
    [selectedKey, keyedRows],
  );

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Users />
            CRM
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {rootPath}
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReload}
            aria-label="Reload CRM"
          >
            <RefreshCw data-icon="inline-start" />
            Reload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPickDifferent}
            aria-label="Pick a different CRM folder"
          >
            <FolderOpen data-icon="inline-start" />
            Pick different
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {filter.trim() !== ""
              ? `${sorted.length} of ${keyedRows.length}`
              : `${keyedRows.length} row${keyedRows.length === 1 ? "" : "s"}`}
            {keyColumn ? (
              <>
                {" "}
                · keyed by <code>{keyColumn}</code>
              </>
            ) : null}
          </p>
          <FilterChip
            value={filter}
            onChange={onFilterChange}
            label="Filter CRM"
            placeholder="Filter…"
          />
        </div>

        <Separator />

        <div className="flex gap-3">
          <ScrollArea className="h-[min(60vh,560px)] flex-1 rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-card text-xs">
                <tr>
                  {headers.map((h) => (
                    <th
                      key={h}
                      className="border-b px-3 py-2 font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(h)}
                        aria-label={`Sort by ${h}`}
                        aria-pressed={sortKey === h ? "true" : "false"}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        {h}
                        {sortKey === h ? (
                          <span aria-hidden="true">
                            {sortDir === "asc" ? "↑" : "↓"}
                          </span>
                        ) : null}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={headers.length}
                      className="px-3 py-6 text-center text-sm text-muted-foreground"
                    >
                      {filter.trim() !== ""
                        ? `No rows match "${filter.trim()}".`
                        : "No rows."}
                    </td>
                  </tr>
                ) : (
                  sorted.map(({ key, row }) => {
                    const isSelected = key === selectedKey;
                    return (
                      <tr
                        key={key}
                        data-selected={isSelected ? "true" : undefined}
                        className={
                          isSelected
                            ? "cursor-pointer bg-muted/50"
                            : "cursor-pointer hover:bg-muted/30"
                        }
                        onClick={() =>
                          onSelect(isSelected ? null : key)
                        }
                      >
                        {headers.map((h) => (
                          <td
                            key={h}
                            className="border-b px-3 py-2 align-top"
                          >
                            <span className="line-clamp-2 break-words">
                              {row[h] ?? ""}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ScrollArea>

          {selected ? (
            <CrmDetailPanel
              rootPath={rootPath}
              rowKey={selected.key}
              row={selected.row}
              headers={headers}
              onClose={() => onSelect(null)}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

type CrmDetailPanelProps = {
  rootPath: string;
  rowKey: string;
  row: CsvRow;
  headers: string[];
  onClose: () => void;
};

type FilesState =
  | { kind: "loading" }
  | { kind: "ready"; entries: FsEntry[] }
  | { kind: "missing" }
  | { kind: "error"; message: string };

function CrmDetailPanel({
  rootPath,
  rowKey,
  row,
  headers,
  onClose,
}: CrmDetailPanelProps) {
  const [files, setFiles] = useState<FilesState>({ kind: "loading" });
  const [previewPath, setPreviewPath] = useState<string | null>(null);

  // Re-fetch the per-row files folder whenever the selection changes.
  // "Folder not present" is a normal state for a row that doesn't
  // have attachments yet — surface it as "missing" rather than as an
  // error.
  useEffect(() => {
    let cancelled = false;
    setFiles({ kind: "loading" });
    setPreviewPath(null);
    void (async () => {
      const dir = filesDirFor(rootPath, rowKey);
      try {
        const entries = await listDirectory(dir);
        if (cancelled) return;
        setFiles({
          kind: "ready",
          entries: entries.filter((e) => !e.isDirectory),
        });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.startsWith("Not a directory")) {
          setFiles({ kind: "missing" });
        } else {
          setFiles({ kind: "error", message: msg });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, rowKey]);

  return (
    <aside
      aria-label="Row detail"
      className="flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-card p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Row
          </p>
          <p className="truncate font-mono text-xs">{rowKey}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close row detail"
        >
          <X data-icon="inline-start" />
        </Button>
      </header>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Fields
        </p>
        <dl className="flex flex-col gap-1.5">
          {headers.map((h) => (
            <div key={h} className="flex flex-col">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {h}
              </dt>
              <dd className="break-words text-sm">{row[h] ?? ""}</dd>
            </div>
          ))}
        </dl>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Files
        </p>
        {files.kind === "loading" ? (
          <p className="text-xs text-muted-foreground">Looking…</p>
        ) : files.kind === "missing" ? (
          <p className="text-xs text-muted-foreground">
            No files attached. Drop one into
            <code className="ml-1 break-all rounded bg-muted px-1 py-0.5 text-[11px]">
              {filesDirFor(rootPath, rowKey)}
            </code>
            .
          </p>
        ) : files.kind === "error" ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {files.message}
          </p>
        ) : files.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">Folder is empty.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.entries.map((f) => (
              <li key={f.path}>
                <CrmFileRow
                  entry={f}
                  onPreview={() => setPreviewPath(f.path)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {previewPath && isImageFile(previewPath) ? (
        <CrmImagePreview
          src={imageSrc(previewPath)}
          name={previewPath.split(/[/\\]/).pop() ?? previewPath}
          onClose={() => setPreviewPath(null)}
        />
      ) : null}
    </aside>
  );
}

function CrmFileRow({
  entry,
  onPreview,
}: {
  entry: FsEntry;
  onPreview: () => void;
}) {
  const isImage = isImageFile(entry.path);
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
      disabled={!isImage}
      onClick={onPreview}
      aria-label={isImage ? `Preview ${entry.name}` : entry.name}
      title={isImage ? "Preview" : "File previews limited to images for now"}
    >
      {isImage ? (
        <ImageIcon data-icon="inline-start" />
      ) : (
        <File data-icon="inline-start" />
      )}
      <span className="min-w-0 flex-1 truncate text-left text-xs">
        {entry.name}
      </span>
      {isImage ? (
        <ChevronRight
          className="size-3.5 text-muted-foreground"
          aria-hidden="true"
        />
      ) : null}
    </Button>
  );
}

function CrmImagePreview({
  src,
  name,
  onClose,
}: {
  src: string;
  name: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div
        className="relative flex max-h-full max-w-full flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClose}
          className="absolute right-2 top-2 z-10"
          aria-label="Close preview"
        >
          <X data-icon="inline-start" />
        </Button>
        <img
          src={src}
          alt={name}
          className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
        />
      </div>
    </div>
  );
}

export const crmAppDescriptor: AppDescriptor = {
  id: "crm",
  title: "CRM",
  dashboardCard: {
    icon: Users,
    description:
      "Browse a local contacts.csv with per-row attachments. Read-only for now.",
    launchLabel: "Open CRM",
    category: "data",
  },
  render: () => <CrmApp />,
};
