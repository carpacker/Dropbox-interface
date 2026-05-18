/**
 * Job Tracker app. Reads `<root>/jobs.csv`, renders a board grouped
 * by a `status` column (auto-detected, case-insensitive; falls back
 * to a single "Backlog" bucket when no column is present). Each card
 * opens a detail panel showing all fields, per-job attachments at
 * `<root>/files/<rowKey>/`, and a read-only activity thread at
 * `<root>/threads/<rowKey>.jsonl`.
 *
 * v1 surface:
 *   - Read CSV + render board.
 *   - Click card → detail panel.
 *   - Edit a row (CSV rewrite via the same writeTextFile path the
 *     CRM uses; atomic, capped at 16MB — see THREAT_MODEL §D-L2).
 *     Most common edit is status change, which moves the card to a
 *     different column.
 *   - View thread (read-only). Counts malformed JSONL lines so the
 *     panel surfaces "N lines skipped" rather than silently dropping.
 *
 * Deferred to v2:
 *   - Add / Delete rows (CRM pattern; not hard to lift over).
 *   - Thread writes (need proper append handling — current
 *     `local_write_text_file` is overwrite-only; multi-writer
 *     append would lose entries).
 *   - CRM linkage (deep-link a `client_id` column to the CRM app).
 *   - Drag-card-between-columns (board ↔ status edit shortcut).
 *
 * Threat model footprint: identical to CRM read + edit + attach
 * (D-L1 / D-L2 / D-L3 / D-L4). No new Rust commands.
 */

import { open } from "@tauri-apps/plugin-dialog";
import {
  Briefcase,
  ChevronLeft,
  File,
  FolderOpen,
  ImageIcon,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FilterChip } from "@/components/filter-chip";
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
import type { AppDescriptor } from "@/lib/apps/types";
import { pickKeyColumn, rowKeyFor } from "@/lib/crm-row-key";
import {
  parseCsv,
  serializeCsv,
  type CsvParseError,
  type CsvRow,
} from "@/lib/csv";
import {
  addRecentJobTracker,
  deriveJobTrackerName,
} from "@/lib/job-tracker-recents";
import {
  jobFilesDirFor,
  jobsCsvPathFor,
  jobThreadPathFor,
  loadJobTrackerConfig,
  saveJobTrackerConfig,
} from "@/lib/job-tracker-config";
import {
  deriveStatusValues,
  FALLBACK_STATUS,
  pickStatusColumn,
  statusOf,
} from "@/lib/job-status";
import { parseThread, type ThreadEntry } from "@/lib/job-thread";
import {
  copyFile,
  createFolder,
  imageSrc,
  isImageFile,
  listDirectory,
  readTextFile,
  writeTextFile,
  type FsEntry,
} from "@/lib/tauri-fs";
import { cn } from "@/lib/utils";

/** Bytes cap for the jobs.csv read. Matches the CRM CSV cap. */
const JOBS_CSV_MAX_BYTES = 10 * 1024 * 1024;
/** Bytes cap for the per-job thread JSONL read. Larger ceiling since
 *  threads accumulate over the life of a job. */
const THREAD_MAX_BYTES = 4 * 1024 * 1024;

type Status =
  | { kind: "unconfigured" }
  | { kind: "loading" }
  | {
      kind: "ready";
      rootPath: string;
      headers: string[];
      rows: CsvRow[];
      keyColumn: string | null;
      statusColumn: string | null;
    }
  | {
      kind: "parse-error";
      rootPath: string;
      errors: CsvParseError[];
    }
  | { kind: "error"; message: string };

export function JobTrackerApp({ initialRoot }: { initialRoot?: string } = {}) {
  const [status, setStatus] = useState<Status>({ kind: "unconfigured" });
  const [filter, setFilter] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Initial mount: prefer a deep-link root; fall back to saved
  // config; fall back to setup card.
  useEffect(() => {
    if (initialRoot) {
      saveJobTrackerConfig({ rootPath: initialRoot });
      void load(initialRoot);
      return;
    }
    const cfg = loadJobTrackerConfig();
    if (cfg.rootPath) void load(cfg.rootPath);
  }, [initialRoot]);

  const load = useCallback(async (rootPath: string) => {
    setStatus({ kind: "loading" });
    setSelectedKey(null);
    setFilter("");
    try {
      const csvPath = jobsCsvPathFor(rootPath);
      const text = await readTextFile(csvPath, JOBS_CSV_MAX_BYTES);
      if (text === null) {
        setStatus({
          kind: "error",
          message: `No jobs.csv at ${csvPath}. Pick a folder containing one or create the file.`,
        });
        return;
      }
      const parsed = parseCsv(text);
      if (!parsed.ok) {
        setStatus({ kind: "parse-error", rootPath, errors: parsed.errors });
        return;
      }
      const keyColumn = pickKeyColumn(parsed.headers);
      const statusColumn = pickStatusColumn(parsed.headers);
      setStatus({
        kind: "ready",
        rootPath,
        headers: parsed.headers,
        rows: parsed.rows,
        keyColumn,
        statusColumn,
      });
      addRecentJobTracker({
        path: rootPath,
        name: deriveJobTrackerName(rootPath),
      });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  const persistRows = useCallback(
    async (nextRows: CsvRow[]): Promise<boolean> => {
      if (status.kind !== "ready") return false;
      const csvPath = jobsCsvPathFor(status.rootPath);
      const out = serializeCsv(status.headers, nextRows);
      try {
        await writeTextFile(csvPath, out);
        setStatus({ ...status, rows: nextRows });
        return true;
      } catch (e) {
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
        return false;
      }
    },
    [status],
  );

  async function handlePickRoot() {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked !== "string") return;
      saveJobTrackerConfig({ rootPath: picked });
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
            <Briefcase />
            Job Tracker
          </CardTitle>
          <CardDescription>
            Pick a folder that contains
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              jobs.csv
            </code>
            and (optionally)
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              files/
            </code>{" "}
            and
            <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">
              threads/
            </code>{" "}
            subfolders.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" onClick={() => void handlePickRoot()}>
            <FolderOpen data-icon="inline-start" />
            Pick Job Tracker folder
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status.kind === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Job Tracker</CardTitle>
          <CardDescription>Loading…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status.kind === "error") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Job Tracker</CardTitle>
          <CardDescription>Something went wrong.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {status.message}
          </p>
          <Button type="button" onClick={() => void handlePickRoot()}>
            <FolderOpen data-icon="inline-start" />
            Pick a different folder
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (status.kind === "parse-error") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Job Tracker</CardTitle>
          <CardDescription>
            Could not parse <code>jobs.csv</code> at{" "}
            <code>{status.rootPath}</code>.
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
    <JobTrackerBoard
      rootPath={status.rootPath}
      headers={status.headers}
      rows={status.rows}
      keyColumn={status.keyColumn}
      statusColumn={status.statusColumn}
      filter={filter}
      onFilterChange={setFilter}
      selectedKey={selectedKey}
      onSelect={setSelectedKey}
      onReload={() => void load(status.rootPath)}
      onPickDifferent={() => void handlePickRoot()}
      persistRows={persistRows}
    />
  );
}

type JobTrackerBoardProps = {
  rootPath: string;
  headers: string[];
  rows: CsvRow[];
  keyColumn: string | null;
  statusColumn: string | null;
  filter: string;
  onFilterChange: (next: string) => void;
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
  onReload: () => void;
  onPickDifferent: () => void;
  persistRows: (next: CsvRow[]) => Promise<boolean>;
};

function JobTrackerBoard({
  rootPath,
  headers,
  rows,
  keyColumn,
  statusColumn,
  filter,
  onFilterChange,
  selectedKey,
  onSelect,
  onReload,
  onPickDifferent,
  persistRows,
}: JobTrackerBoardProps) {
  // Modal mode for the row editor. `edit` carries the original
  // row so save can replace it in place; `add` carries nothing —
  // the editor starts blank and the new row gets appended.
  type EditorMode =
    | { kind: "edit"; key: string; original: CsvRow }
    | { kind: "add" };
  const [editing, setEditing] = useState<EditorMode | null>(null);
  const [deletePending, setDeletePending] = useState<{
    key: string;
    row: CsvRow;
  } | null>(null);
  const [writeInFlight, setWriteInFlight] = useState(false);
  // Drag-drop state. `draggingKey` is the source card; `dragHoverStatus`
  // is the target column under the pointer (so we can highlight it).
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragHoverStatus, setDragHoverStatus] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  /**
   * Re-bucket a card to `targetStatus` by mutating its status column
   * and rewriting the CSV. Reachable from a column drop. No-ops when:
   *   - the row's status is already `targetStatus` (avoid a needless
   *     write + churn)
   *   - the row no longer exists (stale drag id)
   *   - the CSV has no status column (board is a single bucket; nowhere
   *     for the card to go)
   *
   * Failures surface as a `moveError` banner above the board; the
   * underlying `persistRows` will also push the app into the
   * top-level error state if the write itself fails. The two error
   * surfaces are intentional: the banner handles "the move was a no-op
   * but worth telling the user", the top-level handles "the write
   * itself blew up".
   */
  async function handleDropOnStatus(rowKey: string, targetStatus: string) {
    if (!statusColumn) {
      setMoveError(
        "Can't move: this CSV has no status column. Add one to enable the board.",
      );
      return;
    }
    if (!keyColumn) return;
    const row = rows.find((r) => rowKeyFor(r, keyColumn) === rowKey);
    if (!row) {
      setMoveError(`Row ${JSON.stringify(rowKey)} is no longer present.`);
      return;
    }
    const currentStatus = statusOf(row, statusColumn);
    if (currentStatus === targetStatus) return;
    // The synthetic Backlog bucket maps to an empty cell on disk —
    // dragging into Backlog clears the status field rather than
    // writing the literal "Backlog" string.
    const nextStatusValue =
      targetStatus === FALLBACK_STATUS ? "" : targetStatus;
    const nextRow: CsvRow = { ...row, [statusColumn]: nextStatusValue };
    setMoveError(null);
    setWriteInFlight(true);
    try {
      const nextRows = rows.map((r) => (r === row ? nextRow : r));
      await persistRows(nextRows);
    } finally {
      setWriteInFlight(false);
    }
  }

  // Snapshot per-row key once so card key + sidebar lookups agree.
  const keyedRows = useMemo(() => {
    if (!keyColumn) return [];
    const out: Array<{ key: string; row: CsvRow }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const k = rowKeyFor(row, keyColumn);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push({ key: k, row });
    }
    return out;
  }, [rows, keyColumn]);

  const filtered = useMemo(() => {
    const q = filter.trim();
    if (q === "") return keyedRows;
    const tokens = q.toLowerCase().split(/\s+/);
    return keyedRows.filter(({ row }) => {
      const haystack = headers
        .map((h) => row[h] ?? "")
        .join("  ")
        .toLowerCase();
      return tokens.every((t) => haystack.includes(t));
    });
  }, [keyedRows, filter, headers]);

  // Columns are derived from the *full* row set (not the filtered
  // view) so filtering a board doesn't drop entire columns. Cards
  // within each column ARE filtered.
  const statusValues = useMemo(
    () => deriveStatusValues(rows, statusColumn),
    [rows, statusColumn],
  );

  const cardsByStatus = useMemo(() => {
    const map = new Map<string, Array<{ key: string; row: CsvRow }>>();
    for (const v of statusValues) map.set(v, []);
    for (const item of filtered) {
      const s = statusOf(item.row, statusColumn);
      const bucket = map.get(s) ?? [];
      bucket.push(item);
      map.set(s, bucket);
    }
    return map;
  }, [filtered, statusValues, statusColumn]);

  const selected = useMemo(
    () =>
      selectedKey ? keyedRows.find((r) => r.key === selectedKey) ?? null : null,
    [selectedKey, keyedRows],
  );

  // Display-only counts: total jobs vs. visible-after-filter.
  const totalJobs = keyedRows.length;
  const visibleJobs = filtered.length;

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="flex items-center gap-2">
            <Briefcase />
            Job Tracker
          </CardTitle>
          <CardDescription className="truncate font-mono text-xs">
            {rootPath}
          </CardDescription>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => setEditing({ kind: "add" })}
            aria-label="Add a new job"
          >
            <Plus data-icon="inline-start" />
            Add job
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReload}
            aria-label="Reload Job Tracker"
          >
            <RefreshCw data-icon="inline-start" />
            Reload
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPickDifferent}
            aria-label="Pick a different Job Tracker folder"
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
              ? `${visibleJobs} of ${totalJobs}`
              : `${totalJobs} job${totalJobs === 1 ? "" : "s"}`}
            {statusColumn ? (
              <>
                {" "}
                · grouped by <code>{statusColumn}</code>
              </>
            ) : (
              <>
                {" "}
                ·{" "}
                <span className="text-amber-700 dark:text-amber-300">
                  no <code>status</code> column; using a single Backlog bucket
                </span>
              </>
            )}
          </p>
          <FilterChip
            value={filter}
            onChange={onFilterChange}
            label="Filter jobs"
            placeholder="Filter…"
          />
        </div>

        {moveError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {moveError}
          </p>
        ) : null}

        <Separator />

        <div className="flex gap-3">
          <ScrollArea
            className="flex-1 rounded-lg border"
            // Boards scroll horizontally on narrow viewports; keep
            // vertical scrolling inside each column.
          >
            <div
              role="list"
              aria-label="Job board"
              className="flex min-h-[min(60vh,560px)] gap-3 p-3"
            >
              {statusValues.map((s) => (
                <BoardColumn
                  key={s}
                  status={s}
                  cards={cardsByStatus.get(s) ?? []}
                  selectedKey={selectedKey}
                  onSelect={(key) =>
                    onSelect(selectedKey === key ? null : key)
                  }
                  keyColumn={keyColumn}
                  draggingKey={draggingKey}
                  dragHover={dragHoverStatus === s}
                  onDragStartCard={(key) => setDraggingKey(key)}
                  onDragEndCard={() => {
                    setDraggingKey(null);
                    setDragHoverStatus(null);
                  }}
                  onDragEnterColumn={() => {
                    if (draggingKey) setDragHoverStatus(s);
                  }}
                  onDragLeaveColumn={() =>
                    setDragHoverStatus((prev) => (prev === s ? null : prev))
                  }
                  onDropCard={(e) => {
                    e.preventDefault();
                    setDragHoverStatus(null);
                    const raw = e.dataTransfer.getData(JOB_DRAG_MIME);
                    if (!raw) return;
                    let payload: unknown;
                    try {
                      payload = JSON.parse(raw);
                    } catch {
                      return;
                    }
                    if (!isJobDragPayload(payload)) return;
                    void handleDropOnStatus(payload.rowKey, s);
                  }}
                />
              ))}
            </div>
          </ScrollArea>

          {selected ? (
            <JobDetailPanel
              rootPath={rootPath}
              rowKey={selected.key}
              row={selected.row}
              headers={headers}
              onClose={() => onSelect(null)}
              onEdit={() =>
                setEditing({
                  kind: "edit",
                  key: selected.key,
                  original: selected.row,
                })
              }
              onDelete={() =>
                setDeletePending({ key: selected.key, row: selected.row })
              }
            />
          ) : null}
        </div>

        {editing ? (
          <JobRowEditor
            headers={headers}
            keyColumn={keyColumn}
            statusColumn={statusColumn}
            statusValues={statusValues}
            mode={editing}
            inFlight={writeInFlight}
            onCancel={() => setEditing(null)}
            onSave={async (nextRow) => {
              setWriteInFlight(true);
              try {
                let nextRows: CsvRow[];
                if (editing.kind === "add") {
                  nextRows = [...rows, nextRow];
                } else {
                  nextRows = rows.map((r) =>
                    r === editing.original ? nextRow : r,
                  );
                }
                const ok = await persistRows(nextRows);
                if (!ok) {
                  setEditing(null);
                  return;
                }
                // After add: focus the newly-added row so the user
                // sees it in the panel right away. After edit: if
                // the row-key column changed, refocus the new key.
                if (editing.kind === "add") {
                  if (keyColumn) {
                    const newKey = rowKeyFor(nextRow, keyColumn);
                    if (newKey) onSelect(newKey);
                  }
                } else if (
                  keyColumn &&
                  editing.original[keyColumn] !== nextRow[keyColumn]
                ) {
                  const newKey = rowKeyFor(nextRow, keyColumn);
                  if (newKey) onSelect(newKey);
                }
                setEditing(null);
              } finally {
                setWriteInFlight(false);
              }
            }}
          />
        ) : null}

        <ConfirmDialog
          open={deletePending !== null}
          title="Delete this job?"
          body={
            deletePending ? (
              <>
                <p>
                  Remove the job keyed by{" "}
                  <strong>{deletePending.key}</strong> from{" "}
                  <code>jobs.csv</code>?
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  The job's attachments folder and thread file are left
                  in place — clean them up by hand if you want.
                </p>
              </>
            ) : null
          }
          confirmLabel="Delete"
          destructive
          busy={writeInFlight}
          onConfirm={async () => {
            if (!deletePending) return;
            setWriteInFlight(true);
            try {
              const nextRows = rows.filter(
                (r) => r !== deletePending.row,
              );
              const ok = await persistRows(nextRows);
              setDeletePending(null);
              if (ok && selectedKey === deletePending.key) {
                onSelect(null);
              }
            } finally {
              setWriteInFlight(false);
            }
          }}
          onCancel={() => setDeletePending(null)}
        />
      </CardContent>
    </Card>
  );
}

/** Internal MIME type for board card drag payloads. */
const JOB_DRAG_MIME = "application/x-job-tracker-card";

function BoardColumn({
  status,
  cards,
  selectedKey,
  onSelect,
  keyColumn,
  draggingKey,
  dragHover,
  onDragStartCard,
  onDragEndCard,
  onDragEnterColumn,
  onDragLeaveColumn,
  onDropCard,
}: {
  status: string;
  cards: Array<{ key: string; row: CsvRow }>;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  keyColumn: string | null;
  /** Path of the card currently being dragged (so we can dim it). */
  draggingKey: string | null;
  /** True when this column is the hover target. */
  dragHover: boolean;
  onDragStartCard: (key: string) => void;
  onDragEndCard: () => void;
  onDragEnterColumn: () => void;
  onDragLeaveColumn: () => void;
  /** Caller decides what target status to bucket the dropped card into. */
  onDropCard: (e: React.DragEvent<HTMLElement>) => void;
}) {
  return (
    <section
      role="listitem"
      aria-label={`Status: ${status}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={onDragEnterColumn}
      onDragLeave={onDragLeaveColumn}
      onDrop={onDropCard}
      data-drop-hover={dragHover ? "true" : undefined}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition",
        dragHover && "ring-2 ring-foreground/60 ring-offset-2",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-sm font-medium">{status}</h3>
        <span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">
          {cards.length}
        </span>
      </header>
      {cards.length === 0 ? (
        <p className="px-1 py-2 text-xs text-muted-foreground">No jobs.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {cards.map(({ key, row }) => {
            const dragging = draggingKey === key;
            return (
              <li key={key}>
                <button
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    // Encode the row key in the payload; status target
                    // comes from the destination column.
                    e.dataTransfer.setData(
                      JOB_DRAG_MIME,
                      JSON.stringify({ rowKey: key }),
                    );
                    e.dataTransfer.effectAllowed = "move";
                    onDragStartCard(key);
                  }}
                  onDragEnd={() => onDragEndCard()}
                  onClick={() => onSelect(key)}
                  aria-pressed={selectedKey === key ? "true" : "false"}
                  data-dragging={dragging ? "true" : undefined}
                  className={cn(
                    "w-full cursor-grab rounded-md border bg-background p-2 text-left transition hover:border-foreground/40 active:cursor-grabbing",
                    selectedKey === key && "border-foreground/60 shadow-sm",
                    dragging && "opacity-40",
                  )}
                >
                  <p className="line-clamp-2 break-words text-sm font-medium leading-tight">
                    {keyColumn ? row[keyColumn] : key}
                  </p>
                  {/* Show one or two extra fields beneath the name for
                     board-level scannability. Picks the first non-key,
                     non-status columns. */}
                  <CardSubtitle row={row} skip={[keyColumn ?? ""]} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Validate a drag-payload coming back through `dataTransfer.getData`.
 * Defensive because the value is opaque JSON — even though we wrote
 * it ourselves, there's no compile-time guarantee about its shape.
 */
function isJobDragPayload(v: unknown): v is { rowKey: string } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { rowKey?: unknown }).rowKey === "string"
  );
}

function CardSubtitle({
  row,
  skip,
}: {
  row: CsvRow;
  skip: string[];
}) {
  const skipSet = new Set(skip.filter((s) => s !== ""));
  // Find up to 2 non-empty fields outside the skip set.
  const extras: string[] = [];
  for (const key of Object.keys(row)) {
    if (skipSet.has(key)) continue;
    const v = row[key]?.trim();
    if (!v) continue;
    extras.push(v);
    if (extras.length >= 2) break;
  }
  if (extras.length === 0) return null;
  return (
    <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
      {extras.join(" · ")}
    </p>
  );
}

type FilesState =
  | { kind: "loading" }
  | { kind: "ready"; entries: FsEntry[] }
  | { kind: "missing" }
  | { kind: "error"; message: string };

type ThreadState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "ready"; entries: ThreadEntry[]; skipped: number }
  | { kind: "error"; message: string };

function JobDetailPanel({
  rootPath,
  rowKey,
  row,
  headers,
  onClose,
  onEdit,
  onDelete,
}: {
  rootPath: string;
  rowKey: string;
  row: CsvRow;
  headers: string[];
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [files, setFiles] = useState<FilesState>({ kind: "loading" });
  const [thread, setThread] = useState<ThreadState>({ kind: "loading" });
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attachInFlight, setAttachInFlight] = useState(false);

  // Files effect — same shape as the CRM detail panel.
  useEffect(() => {
    let cancelled = false;
    setFiles({ kind: "loading" });
    setPreviewPath(null);
    void (async () => {
      const dir = jobFilesDirFor(rootPath, rowKey);
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
  }, [rootPath, rowKey, refreshTick]);

  // Thread effect.
  useEffect(() => {
    let cancelled = false;
    setThread({ kind: "loading" });
    void (async () => {
      const path = jobThreadPathFor(rootPath, rowKey);
      try {
        const text = await readTextFile(path, THREAD_MAX_BYTES);
        if (cancelled) return;
        if (text === null) {
          setThread({ kind: "missing" });
          return;
        }
        const parsed = parseThread(text);
        setThread({
          kind: "ready",
          entries: parsed.entries,
          skipped: parsed.skipped,
        });
      } catch (e) {
        if (cancelled) return;
        setThread({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rootPath, rowKey]);

  async function handleAttach() {
    setAttachError(null);
    let picked: string | null;
    try {
      const result = await open({ directory: false, multiple: false });
      picked = typeof result === "string" ? result : null;
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!picked) return;
    const dir = jobFilesDirFor(rootPath, rowKey);
    const basename = picked.split(/[/\\]/).pop() ?? "attachment";
    const sep = dir.includes("\\") ? "\\" : "/";
    const dest = `${dir}${sep}${basename}`;

    setAttachInFlight(true);
    try {
      try {
        await createFolder(dir);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("already exists")) throw err;
      }
      await copyFile(picked, dest);
      setRefreshTick((n) => n + 1);
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e));
    } finally {
      setAttachInFlight(false);
    }
  }

  return (
    <aside
      aria-label="Job detail"
      className="flex w-96 shrink-0 flex-col gap-3 rounded-lg border bg-card p-3"
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Job
          </p>
          <p className="truncate font-mono text-xs">{rowKey}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close job detail"
        >
          <X data-icon="inline-start" />
        </Button>
      </header>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onEdit}
          aria-label="Edit job"
        >
          <Pencil data-icon="inline-start" />
          Edit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onDelete}
          aria-label="Delete job"
          className="text-destructive hover:bg-destructive/10"
        >
          <Trash2 data-icon="inline-start" />
          Delete
        </Button>
      </div>

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
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Files
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={attachInFlight}
            onClick={() => void handleAttach()}
            aria-label="Attach file to job"
          >
            <Paperclip data-icon="inline-start" />
            {attachInFlight ? "Copying…" : "Attach…"}
          </Button>
        </div>
        {attachError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {attachError}
          </p>
        ) : null}
        {files.kind === "loading" ? (
          <p className="text-xs text-muted-foreground">Looking…</p>
        ) : files.kind === "missing" ? (
          <p className="text-xs text-muted-foreground">
            No files attached. Use <strong>Attach…</strong> above, or drop
            a file into
            <code className="ml-1 break-all rounded bg-muted px-1 py-0.5 text-[11px]">
              {jobFilesDirFor(rootPath, rowKey)}
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
                <JobFileRow
                  entry={f}
                  onPreview={() => setPreviewPath(f.path)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <MessageSquare className="size-3" aria-hidden="true" />
          Thread
        </p>
        <JobThreadView state={thread} />
      </div>

      {previewPath && isImageFile(previewPath) ? (
        <JobImagePreview
          src={imageSrc(previewPath)}
          name={previewPath.split(/[/\\]/).pop() ?? previewPath}
          onClose={() => setPreviewPath(null)}
        />
      ) : null}
    </aside>
  );
}

function JobFileRow({
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
      title={isImage ? "Preview" : "Preview supported on images only"}
    >
      {isImage ? (
        <ImageIcon data-icon="inline-start" />
      ) : (
        <File data-icon="inline-start" />
      )}
      <span className="min-w-0 flex-1 truncate text-left text-xs">
        {entry.name}
      </span>
    </Button>
  );
}

function JobThreadView({ state }: { state: ThreadState }) {
  if (state.kind === "loading") {
    return <p className="text-xs text-muted-foreground">Looking…</p>;
  }
  if (state.kind === "missing") {
    return (
      <p className="text-xs text-muted-foreground">
        No thread yet. Drop a{" "}
        <code className="rounded bg-muted px-1 py-0.5 text-[11px]">
          .jsonl
        </code>{" "}
        file into the job's threads/ folder to start the log.
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
      >
        {state.message}
      </p>
    );
  }
  if (state.entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Thread file is present but has no valid entries.
        {state.skipped > 0 ? ` (${state.skipped} line(s) skipped.)` : null}
      </p>
    );
  }
  return (
    <>
      {state.skipped > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {state.skipped} malformed line{state.skipped === 1 ? "" : "s"}{" "}
          skipped.
        </p>
      ) : null}
      <ol className="flex flex-col gap-2">
        {state.entries.map((e, i) => (
          <li
            key={`${e.at}-${i}`}
            className="rounded-md border bg-background p-2"
          >
            <div className="flex items-baseline justify-between gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span>{e.by}</span>
              <span title={e.at}>{e.at}</span>
            </div>
            <p className="mt-1 break-words text-sm">{e.body}</p>
            {e.kind === "email-link" ? (
              <span className="mt-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                email
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </>
  );
}

function JobImagePreview({
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

/**
 * Job-row editor. Same modal shape as `CrmRowEditor` but the status
 * column renders as a select populated from known values so changing
 * a job's status doesn't depend on the user typing the bucket name
 * exactly right.
 */
function JobRowEditor({
  headers,
  keyColumn,
  statusColumn,
  statusValues,
  mode,
  inFlight,
  onCancel,
  onSave,
}: {
  headers: string[];
  keyColumn: string | null;
  statusColumn: string | null;
  statusValues: string[];
  /** Editor mode: `edit` carries the original row; `add` starts blank. */
  mode:
    | { kind: "edit"; key: string; original: CsvRow }
    | { kind: "add" };
  inFlight: boolean;
  onCancel: () => void;
  onSave: (row: CsvRow) => void;
}) {
  const isAdd = mode.kind === "add";
  const initial = useMemo<CsvRow>(() => {
    if (mode.kind === "edit") return { ...mode.original };
    // Add: blank values for every header; pre-fill the status with
    // the first non-synthetic value so the new card lands in a real
    // column instead of the Backlog sink.
    const out: CsvRow = {};
    for (const h of headers) out[h] = "";
    if (statusColumn) {
      const firstReal = statusValues.find((v) => v !== FALLBACK_STATUS);
      if (firstReal) out[statusColumn] = firstReal;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, headers, statusColumn]);
  const [values, setValues] = useState<CsvRow>(initial);
  const [localError, setLocalError] = useState<string | null>(null);

  // Status options = derived statuses + the row's current value if
  // it isn't already in there (defensive against an edit-after-delete
  // race).
  const statusOptions = useMemo(() => {
    if (!statusColumn) return [];
    const opts = [...statusValues];
    // Drop the synthetic fallback from the dropdown — the user
    // should pick a real status, not stuff "Backlog" into an
    // arbitrary CSV. Items can still land there by leaving the
    // field blank, but the picker doesn't volunteer it.
    const cleaned = opts.filter((v) => v !== FALLBACK_STATUS);
    if (mode.kind === "edit") {
      const current = (mode.original[statusColumn] ?? "").trim();
      if (current !== "" && !cleaned.includes(current)) {
        cleaned.unshift(current);
      }
    }
    return cleaned;
  }, [statusValues, statusColumn, mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  function handleSave() {
    if (keyColumn) {
      const v = (values[keyColumn] ?? "").trim();
      if (v === "") {
        setLocalError(`The ${keyColumn} column is required.`);
        return;
      }
      const previewed = rowKeyFor(values, keyColumn);
      if (!previewed) {
        setLocalError(
          `${JSON.stringify(v)} sanitizes to an empty key.`,
        );
        return;
      }
    }
    setLocalError(null);
    onSave(values);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAdd ? "Add job" : "Edit job"}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-card p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium">
            {isAdd ? "Add job" : "Edit job"}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onCancel}
            aria-label="Close editor"
          >
            <X data-icon="inline-start" />
          </Button>
        </div>
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
          {headers.map((h) => (
            <div key={h} className="flex flex-col gap-1">
              <label
                htmlFor={`job-edit-${h}`}
                className="text-[10px] uppercase tracking-wide text-muted-foreground"
              >
                {h}
                {keyColumn === h ? (
                  <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                    key
                  </span>
                ) : null}
                {statusColumn === h ? (
                  <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px]">
                    status
                  </span>
                ) : null}
              </label>
              {statusColumn === h && statusOptions.length > 0 ? (
                <select
                  id={`job-edit-${h}`}
                  value={values[h] ?? ""}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    setValues((prev) => ({ ...prev, [h]: next }));
                  }}
                  aria-label={h}
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">(leave blank → Backlog)</option>
                  {statusOptions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`job-edit-${h}`}
                  value={values[h] ?? ""}
                  onChange={(e) => {
                    const next = e.currentTarget.value;
                    setValues((prev) => ({ ...prev, [h]: next }));
                  }}
                  aria-label={h}
                />
              )}
            </div>
          ))}
        </div>
        {localError ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            {localError}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={inFlight}
          >
            <ChevronLeft data-icon="inline-start" />
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={inFlight}>
            {inFlight ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export const jobTrackerAppDescriptor: AppDescriptor = {
  id: "job-tracker",
  title: "Job Tracker",
  dashboardCard: {
    icon: Briefcase,
    description:
      "Board view of jobs.csv grouped by status. Per-job attachments + activity thread.",
    launchLabel: "Open Job Tracker",
    category: "data",
  },
  render: ({ deepLink }) => (
    <JobTrackerApp
      initialRoot={typeof deepLink === "string" ? deepLink : undefined}
    />
  ),
};
