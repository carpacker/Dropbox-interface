/**
 * Pipeline view for Dropbox-backed folders that ship a
 * `.dropbox-interface.json` config. Read-only for v1: shows a tab strip
 * of state buckets (plus an Inbox bucket for unfiled items) and renders
 * the selected bucket's contents using the standard Dropbox row
 * primitives.
 *
 * Lazy-loads state folder listings on bucket selection so we don't
 * block the initial render on N parallel API calls.
 */

import {
  AlertTriangle,
  FolderPlus,
  Pin,
  PinOff,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  classifyParentListing,
  type EntryHandle,
} from "@/lib/pipeline/pipeline";
import { nextState } from "@/lib/pipeline/pipeline";
import type { PipelineConfig, PipelineState } from "@/lib/pipeline/schema";
import {
  getAllNotes,
  getNote,
  setNote,
  type NotesByPath,
} from "@/lib/pipeline-notes";
import { joinDropboxPath } from "@/lib/dropbox-pipeline-source";
import { getRecentPipelines, setPinned } from "@/lib/pipeline-recents";
import {
  loadSortPreference,
  saveSortPreference,
  sortEntries,
  type SortPreference,
} from "@/lib/sort";
import { SortDropdown } from "@/components/sort-dropdown";
import {
  dropboxCreateFolder,
  dropboxEntryToSortable,
  dropboxListFolder,
  dropboxMove,
  type DropboxEntry,
} from "@/lib/tauri-dropbox";
import { cn } from "@/lib/utils";

const INBOX_ID = "__inbox__";

/** Internal MIME type for the drag-and-drop payload between buckets. */
const DRAG_MIME = "application/x-dropbox-pipeline-entry";

/** Shared frozen Set so default selection state has a stable identity. */
const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>());

type StateListing =
  | { kind: "loading" }
  | { kind: "ready"; entries: DropboxEntry[] }
  | { kind: "error"; message: string };

type Bucket =
  | { kind: "inbox"; id: typeof INBOX_ID; name: string; count: number }
  | {
      kind: "state";
      id: string;
      name: string;
      state: PipelineState;
      folder: EntryHandle;
      count: number | null; // null = listing not loaded yet
    };

type PipelineViewProps = {
  parentPath: string;
  config: PipelineConfig;
  /** Listing of the parent folder, already fetched by the caller. */
  parentEntries: DropboxEntry[];
  /** Caller-driven navigation when the user opens a folder *inside* a state. */
  onNavigateInto: (path: string) => void;
  /**
   * Re-fetch the parent listing. Called after we successfully create a
   * missing state folder so the new folder appears in the strip.
   */
  onParentRefresh: () => void;
  /** Per-row actions delegated to the caller. */
  onPreviewImage: (entry: DropboxEntry) => void;
  onSaveFile: (entry: DropboxEntry) => void;
  savingPath: string | null;
  renderEntryRow: (
    entry: DropboxEntry,
    opts: {
      saving: boolean;
      onPreview: () => void;
      onSave: () => void;
      onOpenFolder: (path: string) => void;
      promote?: {
        targetStateName: string;
        inFlight: boolean;
        onClick: () => void;
      };
      /**
       * Bulk-select state for the row. Present in pipeline view only;
       * absent in the flat browser. Caller decides whether to render a
       * checkbox.
       */
      select?: {
        selected: boolean;
        onToggle: () => void;
      };
      /**
       * Local-only review note attached to this row. `hasNote` drives
       * the indicator dot; `onClick` opens the editor modal.
       */
      note?: {
        hasNote: boolean;
        onClick: () => void;
      };
    },
  ) => ReactNode;
};

/**
 * Discriminator for which bucket an item came from / is heading to. The
 * Inbox is the parent folder itself; state buckets are subfolders. Move
 * refresh logic is different for each (parent listing vs state listing).
 */
type BucketRef =
  | { kind: "inbox" }
  | { kind: "state"; id: string };

type SingleMove = {
  fromPath: string;
  toPath: string;
  entryName: string;
};

type UndoableMove = {
  /**
   * Array of moves the user can undo as a unit. Always at least one
   * entry; the bulk Promote action populates it with multiple, the
   * single-row Promote button populates it with one.
   */
  moves: SingleMove[];
  destBucketName: string;
  /** Source + destination buckets so undo can re-invalidate the right ones. */
  sourceBucket: BucketRef;
  destBucket: BucketRef;
};

export function PipelineView(props: PipelineViewProps) {
  const {
    parentPath,
    config,
    parentEntries,
    onNavigateInto,
    onParentRefresh,
    onPreviewImage,
    onSaveFile,
    savingPath,
    renderEntryRow,
  } = props;

  // EntryHandle adapters for the pure classification helper.
  const parentHandles: EntryHandle[] = useMemo(
    () =>
      parentEntries.map((e) => ({
        name: e.name,
        path: e.path,
        isDirectory: e.kind === "folder",
      })),
    [parentEntries],
  );

  const classification = useMemo(
    () => classifyParentListing(parentHandles, config),
    [parentHandles, config],
  );

  // Build buckets: optional Inbox + every present state.
  const showInbox = config.inbox.show;
  const inboxName = config.inbox.name ?? "Inbox";

  const [stateListings, setStateListings] = useState<
    Record<string, StateListing>
  >({});

  // Tracks state ids whose fetch is in-flight or done, so the lazy-load
  // effect can be idempotent without putting `stateListings` in its dep
  // array (which would cause the effect to re-run on every fetch step
  // and cancel itself).
  const fetchedRef = useRef<Set<string>>(new Set());

  // Reset the listings cache when the parent folder changes — different
  // parent means different state-folder paths.
  useEffect(() => {
    setStateListings({});
    fetchedRef.current = new Set();
  }, [parentPath]);

  // Promote / Undo / Create-folder state. `movingPaths` is a Set so the
  // bulk Promote can mark multiple rows in flight simultaneously.
  const [movingPaths, setMovingPaths] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [undoableMove, setUndoableMove] = useState<UndoableMove | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingState, setCreatingState] = useState<string | null>(null);

  /**
   * Selection state for bulk Promote. Keyed by bucket id so a user can
   * select items in Processing, switch to Ready to verify something,
   * then come back without losing their selection. Cleared on parent
   * change (different folder = different state-folder paths).
   */
  const [selectedByBucket, setSelectedByBucket] = useState<
    Record<string, ReadonlySet<string>>
  >({});
  useEffect(() => {
    setSelectedByBucket({});
  }, [parentPath]);

  // Drag-and-drop state. Path of the row currently being dragged (so we
  // can dim it) and the bucket id currently under the pointer (so we can
  // highlight the drop target).
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dragHoverBucketId, setDragHoverBucketId] = useState<string | null>(
    null,
  );

  // Pin state for the current pipeline parent. Reads from
  // pipeline-recents on mount + after toggle so the header reflects
  // localStorage truth without requiring a route refresh.
  const [isPinned, setIsPinned] = useState<boolean>(() =>
    Boolean(getRecentPipelines().find((r) => r.path === parentPath)?.pinned),
  );
  useEffect(() => {
    setIsPinned(
      Boolean(getRecentPipelines().find((r) => r.path === parentPath)?.pinned),
    );
  }, [parentPath]);

  function togglePin() {
    const next = !isPinned;
    setPinned(parentPath, next);
    setIsPinned(next);
  }

  // Sort preference — shared globally with the rest of the app via
  // localStorage so a user's "newest first" choice carries from the
  // local file browser into Dropbox bucket listings.
  const [sort, setSort] = useState<SortPreference>(() =>
    loadSortPreference(),
  );
  function updateSort(next: SortPreference) {
    setSort(next);
    saveSortPreference(next);
  }

  /**
   * Notes are local-only and keyed by Dropbox path. We snapshot the
   * full table on mount + after every save so the indicator dots can
   * render in O(1) per row.
   */
  const [notesByPath, setNotesByPath] = useState<NotesByPath>(() =>
    getAllNotes(),
  );
  const [editingNoteEntry, setEditingNoteEntry] = useState<DropboxEntry | null>(
    null,
  );

  function openNoteEditor(entry: DropboxEntry) {
    setEditingNoteEntry(entry);
  }
  function closeNoteEditor() {
    setEditingNoteEntry(null);
  }
  function saveNote(entry: DropboxEntry, body: string) {
    setNote(entry.path, body);
    setNotesByPath(getAllNotes());
    setEditingNoteEntry(null);
  }

  // Auto-dismiss the undo toast after 8s. Cleared early when the user
  // clicks Dismiss or the parent path changes.
  useEffect(() => {
    if (!undoableMove) return;
    const id = setTimeout(() => setUndoableMove(null), 8_000);
    return () => clearTimeout(id);
  }, [undoableMove]);
  useEffect(() => {
    setUndoableMove(null);
  }, [parentPath]);

  /** Refresh exactly one state's listing, replacing the cached value. */
  function refreshStateListing(stateId: string, folderPath: string | null) {
    if (!folderPath) {
      setStateListings((prev) => {
        const next = { ...prev };
        delete next[stateId];
        return next;
      });
      fetchedRef.current.delete(stateId);
      return;
    }
    setStateListings((prev) => ({
      ...prev,
      [stateId]: { kind: "loading" },
    }));
    fetchedRef.current.add(stateId);
    void (async () => {
      try {
        const entries = await dropboxListFolder(folderPath);
        setStateListings((prev) => ({
          ...prev,
          [stateId]: { kind: "ready", entries },
        }));
      } catch (e) {
        fetchedRef.current.delete(stateId);
        setStateListings((prev) => ({
          ...prev,
          [stateId]: {
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    })();
  }

  /**
   * Refresh a single bucket after a successful move. State buckets get
   * a fresh listing fetch; the Inbox is rederived from the parent
   * listing, so we ask the caller to re-fetch that.
   */
  function refreshBucket(bucket: BucketRef, toFolderPath: string | null) {
    if (bucket.kind === "inbox") {
      onParentRefresh();
    } else {
      refreshStateListing(bucket.id, toFolderPath);
    }
  }

  /**
   * Display name for a bucket; used in the Promote button label and the
   * Undo toast.
   */
  function bucketName(bucket: BucketRef): string {
    if (bucket.kind === "inbox") return config.inbox.name ?? "Inbox";
    return config.states.find((s) => s.id === bucket.id)?.name ?? bucket.id;
  }

  async function performMove(
    entry: { path: string; name: string },
    sourceBucket: BucketRef,
    destBucket: BucketRef,
    destFolderPath: string,
  ) {
    setActionError(null);
    setMovingPaths(new Set([entry.path]));
    const toPath = joinDropboxPath(destFolderPath, entry.name);
    try {
      await dropboxMove(entry.path, toPath);
      refreshBucket(sourceBucket, parentFolderOfPath(entry.path));
      refreshBucket(destBucket, destFolderPath);
      setUndoableMove({
        moves: [{ fromPath: entry.path, toPath, entryName: entry.name }],
        destBucketName: bucketName(destBucket),
        sourceBucket,
        destBucket,
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setMovingPaths(new Set());
    }
  }

  /**
   * Run multiple moves in parallel. Partial-success aware: refreshes
   * buckets either way, queues a single batch undo for the moves that
   * succeeded, and surfaces a count for the ones that failed.
   */
  async function performBulkMove(
    entries: Array<{ path: string; name: string }>,
    sourceBucket: BucketRef,
    destBucket: BucketRef,
    destFolderPath: string,
  ) {
    if (entries.length === 0) return;
    setActionError(null);
    setMovingPaths(new Set(entries.map((e) => e.path)));
    const sourceFolderPath = parentFolderOfPath(entries[0].path);

    const results = await Promise.allSettled(
      entries.map(async (e) => {
        const toPath = joinDropboxPath(destFolderPath, e.name);
        await dropboxMove(e.path, toPath);
        return {
          fromPath: e.path,
          toPath,
          entryName: e.name,
        } satisfies SingleMove;
      }),
    );

    const succeeded: SingleMove[] = [];
    const failed: string[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") {
        succeeded.push(r.value);
      } else {
        failed.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }

    refreshBucket(sourceBucket, sourceFolderPath);
    refreshBucket(destBucket, destFolderPath);

    if (succeeded.length > 0) {
      setUndoableMove({
        moves: succeeded,
        destBucketName: bucketName(destBucket),
        sourceBucket,
        destBucket,
      });
      // Drop the successful entries from the bucket's selection.
      setSelectedByBucket((prev) => {
        if (sourceBucket.kind === "state") {
          const sel = prev[sourceBucket.id];
          if (!sel) return prev;
          const next = new Set(sel);
          for (const m of succeeded) next.delete(m.fromPath);
          return { ...prev, [sourceBucket.id]: next };
        }
        if (sourceBucket.kind === "inbox") {
          const sel = prev[INBOX_ID];
          if (!sel) return prev;
          const next = new Set(sel);
          for (const m of succeeded) next.delete(m.fromPath);
          return { ...prev, [INBOX_ID]: next };
        }
        return prev;
      });
    }

    if (failed.length > 0) {
      setActionError(
        `${failed.length} of ${entries.length} moves failed. ` +
          `First error: ${failed[0]}`,
      );
    }

    setMovingPaths(new Set());
  }

  async function handleUndo() {
    if (!undoableMove) return;
    const move = undoableMove;
    setUndoableMove(null);
    setActionError(null);
    setMovingPaths(new Set(move.moves.map((m) => m.toPath)));
    try {
      const results = await Promise.allSettled(
        move.moves.map((m) => dropboxMove(m.toPath, m.fromPath)),
      );
      const failed = results.filter((r) => r.status === "rejected");
      // Refresh once at the end whether all succeeded or some didn't.
      refreshBucket(move.sourceBucket, parentFolderOfPath(move.moves[0].fromPath));
      refreshBucket(move.destBucket, parentFolderOfPath(move.moves[0].toPath));
      if (failed.length > 0) {
        setActionError(
          `Could not undo ${failed.length} of ${move.moves.length} moves.`,
        );
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setMovingPaths(new Set());
    }
  }

  async function handleCreateMissingFolder(state: PipelineState) {
    setActionError(null);
    setCreatingState(state.id);
    try {
      await dropboxCreateFolder(`${parentPath}/${state.folder}`);
      onParentRefresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingState(null);
    }
  }

  /**
   * Drop handler factory for a bucket chip. Validates the drag payload,
   * skips no-op same-bucket drops, and dispatches a move from the source
   * bucket (encoded in the dataTransfer) to this target bucket.
   */
  function handleDropOnBucket(targetBucket: Bucket) {
    return (e: React.DragEvent<HTMLButtonElement>) => {
      e.preventDefault();
      setDragHoverBucketId(null);
      const raw = e.dataTransfer.getData(DRAG_MIME);
      if (!raw) return;
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!isDragPayload(payload)) return;
      const targetRef = bucketAsRef(targetBucket);
      if (sameBucketRef(payload.source, targetRef)) return;

      const destFolderPath =
        targetBucket.kind === "inbox"
          ? parentPath
          : targetBucket.folder.path;

      void performMove(
        { path: payload.path, name: payload.name },
        payload.source,
        targetRef,
        destFolderPath,
      );
    };
  }

  const buckets: Bucket[] = useMemo(() => {
    const out: Bucket[] = [];
    if (showInbox) {
      out.push({
        kind: "inbox",
        id: INBOX_ID,
        name: inboxName,
        count: classification.inbox.length,
      });
    }
    for (const state of config.states) {
      const folder = classification.stateFolders[state.id];
      if (!folder) continue;
      const listing = stateListings[state.id];
      const count =
        listing && listing.kind === "ready" ? listing.entries.length : null;
      out.push({
        kind: "state",
        id: state.id,
        name: state.name,
        state,
        folder,
        count,
      });
    }
    return out;
  }, [
    showInbox,
    inboxName,
    classification,
    config.states,
    stateListings,
  ]);

  const [selectedId, setSelectedId] = useState<string>(() => buckets[0]?.id ?? "");

  // Keep selection valid when the bucket set shifts (e.g. parent changes).
  useEffect(() => {
    if (buckets.length === 0) return;
    if (!buckets.some((b) => b.id === selectedId)) {
      setSelectedId(buckets[0].id);
    }
  }, [buckets, selectedId]);

  // Lazy-load the selected state's folder listing. Driven by selectedId
  // + classification only; the in-flight guard lives in `fetchedRef` so
  // we don't bake `stateListings` into the dep array (which would let
  // each setState trigger a self-cancelling re-run).
  useEffect(() => {
    if (!selectedId || selectedId === INBOX_ID) return;
    const folder = classification.stateFolders[selectedId];
    if (!folder) return;
    if (fetchedRef.current.has(selectedId)) return;
    fetchedRef.current.add(selectedId);

    let cancelled = false;
    let settled = false;
    setStateListings((prev) => ({
      ...prev,
      [selectedId]: { kind: "loading" },
    }));
    void (async () => {
      try {
        const entries = await dropboxListFolder(folder.path);
        settled = true;
        if (cancelled) return;
        setStateListings((prev) => ({
          ...prev,
          [selectedId]: { kind: "ready", entries },
        }));
      } catch (e) {
        settled = true;
        if (cancelled) return;
        // Drop from the in-flight set so a re-select can retry.
        fetchedRef.current.delete(selectedId);
        setStateListings((prev) => ({
          ...prev,
          [selectedId]: {
            kind: "error",
            message: e instanceof Error ? e.message : String(e),
          },
        }));
      }
    })();
    return () => {
      cancelled = true;
      // If the fetch was still in-flight at unmount, drop the in-flight
      // marker so a return to this bucket re-fetches instead of
      // wedging at "Loading…". If the fetch already settled (success
      // or error), preserve the cache: keep the ref so re-selecting
      // doesn't issue a redundant API call.
      if (!settled) {
        fetchedRef.current.delete(selectedId);
      }
    };
  }, [selectedId, classification]);

  // Render the contents of the selected bucket.
  const selectedBucket = buckets.find((b) => b.id === selectedId);

  // Compute promote info for the selected bucket. Promote is offered:
  //   - inside a state bucket whose successor has a present folder
  //   - inside the Inbox bucket when the *first* state has a present folder
  // (the latter is the "file into <first state>" verb).
  const promoteContext = useMemo<PromoteContext | null>(() => {
    if (!selectedBucket) return null;
    let target: PipelineState | null = null;
    let sourceBucket: BucketRef;
    if (selectedBucket.kind === "inbox") {
      target = config.states[0] ?? null;
      sourceBucket = { kind: "inbox" };
    } else {
      target = nextState(config, selectedBucket.id);
      sourceBucket = { kind: "state", id: selectedBucket.id };
    }
    if (!target) return null;
    const destFolder = classification.stateFolders[target.id];
    if (!destFolder) return null; // destination folder isn't there
    return {
      sourceBucket,
      destBucket: { kind: "state", id: target.id },
      destStateName: target.name,
      destFolderPath: destFolder.path,
    };
  }, [selectedBucket, config, classification]);

  // Per-bucket selection set for the *currently-selected* bucket.
  const selectedPaths: ReadonlySet<string> =
    selectedByBucket[selectedId] ?? EMPTY_SET;

  function toggleSelect(entryPath: string) {
    setSelectedByBucket((prev) => {
      const current = prev[selectedId] ?? EMPTY_SET;
      const next = new Set(current);
      if (next.has(entryPath)) {
        next.delete(entryPath);
      } else {
        next.add(entryPath);
      }
      return { ...prev, [selectedId]: next };
    });
  }

  function clearSelection() {
    setSelectedByBucket((prev) => ({
      ...prev,
      [selectedId]: EMPTY_SET,
    }));
  }

  const contents = renderBucketContents({
    bucket: selectedBucket,
    classification,
    parentEntries,
    stateListings,
    onPreviewImage,
    onSaveFile,
    savingPath,
    onNavigateInto,
    renderEntryRow,
    promoteContext,
    movingPaths,
    onPromote: (entry) => {
      if (!promoteContext) return;
      void performMove(
        entry,
        promoteContext.sourceBucket,
        promoteContext.destBucket,
        promoteContext.destFolderPath,
      );
    },
    sourceBucketRef: selectedBucket
      ? bucketAsRef(selectedBucket)
      : { kind: "inbox" },
    draggingPath,
    onDragStart: (entry) => setDraggingPath(entry.path),
    onDragEnd: () => setDraggingPath(null),
    selectedPaths,
    onToggleSelect: toggleSelect,
    notesByPath,
    onOpenNote: openNoteEditor,
    sort,
  });

  const missing = classification.missing;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">{config.name ?? "Pipeline"}</p>
          {config.description ? (
            <p className="text-xs text-muted-foreground">{config.description}</p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={togglePin}
          aria-label={isPinned ? "Unpin pipeline" : "Pin pipeline"}
          aria-pressed={isPinned ? "true" : "false"}
          title={
            isPinned
              ? "Pinned — appears at the top of Recent pipelines"
              : "Pin this pipeline to the top of Recent pipelines"
          }
        >
          {isPinned ? <Pin /> : <PinOff />}
          <span className="hidden sm:inline">{isPinned ? "Pinned" : "Pin"}</span>
        </Button>
      </div>

      {missing.length > 0 ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-300"
        >
          <AlertTriangle data-icon="inline-start" className="mt-0.5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-2">
            <p className="font-medium">
              {missing.length === 1
                ? "1 declared state has no folder yet"
                : `${missing.length} declared states have no folder yet`}
            </p>
            <ul className="flex flex-col gap-1.5">
              {missing.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <span className="truncate">
                    “{s.name}” (<code>{s.folder}</code>)
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={creatingState !== null}
                    onClick={() => void handleCreateMissingFolder(s)}
                    aria-label={`Create folder ${s.folder}`}
                  >
                    <FolderPlus data-icon="inline-start" />
                    {creatingState === s.id ? "Creating…" : "Create folder"}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {actionError}
        </p>
      ) : null}

      {undoableMove ? (
        <div
          role="status"
          aria-label="Move completed"
          className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
        >
          <span className="truncate">
            {undoableMove.moves.length === 1 ? (
              <>
                Moved <strong>{undoableMove.moves[0].entryName}</strong> to{" "}
                <strong>{undoableMove.destBucketName}</strong>.
              </>
            ) : (
              <>
                Moved <strong>{undoableMove.moves.length} items</strong> to{" "}
                <strong>{undoableMove.destBucketName}</strong>.
              </>
            )}
          </span>
          <span className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleUndo()}
              aria-label="Undo move"
            >
              <Undo2 data-icon="inline-start" />
              Undo
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setUndoableMove(null)}
              aria-label="Dismiss undo notification"
            >
              <X data-icon="inline-start" />
            </Button>
          </span>
        </div>
      ) : null}

      <div
        role="tablist"
        aria-label="Pipeline buckets"
        className="flex flex-wrap gap-2"
      >
        {buckets.map((b) => (
          <BucketChip
            key={b.id}
            bucket={b}
            selected={b.id === selectedId}
            onSelect={() => setSelectedId(b.id)}
            dragHover={dragHoverBucketId === b.id}
            onDragEnter={() => {
              if (draggingPath) setDragHoverBucketId(b.id);
            }}
            onDragLeave={() =>
              setDragHoverBucketId((prev) => (prev === b.id ? null : prev))
            }
            onDrop={handleDropOnBucket(b)}
          />
        ))}
      </div>

      <div className="flex items-center justify-end gap-2">
        <SortDropdown value={sort} onChange={updateSort} compact />
      </div>

      <Separator />

      {selectedPaths.size > 0 ? (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm"
        >
          <span>
            <strong>{selectedPaths.size}</strong> selected
          </span>
          <span className="flex shrink-0 gap-2">
            {promoteContext ? (
              <Button
                type="button"
                size="sm"
                disabled={movingPaths.size > 0}
                onClick={() => {
                  if (!promoteContext) return;
                  // Resolve selected paths to entries from the current bucket's
                  // listing so we have name (needed to compute toPath).
                  const entriesNow = currentBucketEntries(
                    selectedBucket,
                    classification,
                    parentEntries,
                    stateListings,
                  );
                  const picked = entriesNow.filter((e) =>
                    selectedPaths.has(e.path),
                  );
                  void performBulkMove(
                    picked.map((e) => ({ path: e.path, name: e.name })),
                    promoteContext.sourceBucket,
                    promoteContext.destBucket,
                    promoteContext.destFolderPath,
                  );
                }}
              >
                Promote {selectedPaths.size} to {promoteContext.destStateName}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearSelection}
              aria-label="Clear selection"
            >
              Clear
            </Button>
          </span>
        </div>
      ) : null}

      <div
        role="tabpanel"
        aria-label={selectedBucket?.name ?? "Pipeline contents"}
      >
        {contents}
      </div>

      {editingNoteEntry ? (
        <NoteEditorModal
          entry={editingNoteEntry}
          initialBody={getNote(editingNoteEntry.path)?.body ?? ""}
          onSave={(body) => saveNote(editingNoteEntry, body)}
          onClose={closeNoteEditor}
        />
      ) : null}
    </div>
  );
}

function NoteEditorModal({
  entry,
  initialBody,
  onSave,
  onClose,
}: {
  entry: DropboxEntry;
  initialBody: string;
  onSave: (body: string) => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState(initialBody);

  // Esc closes the modal without saving.
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
      aria-label={`Note: ${entry.name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div
        className="flex w-full max-w-lg flex-col gap-3 rounded-lg border bg-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">Note</p>
            <p className="truncate font-mono text-xs text-muted-foreground">
              {entry.name}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close note editor"
          >
            <X data-icon="inline-start" />
          </Button>
        </div>
        <textarea
          autoFocus
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          rows={6}
          aria-label="Note body"
          className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Notes are local to this machine — not synced via Dropbox."
        />
        <p className="text-xs text-muted-foreground">
          Stored in <code>localStorage</code>. Saving an empty note clears it.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={() => onSave(body)}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Resolve a bucket to the DropboxEntry list that backs it. Inbox →
 * the inbox classification slice; state → the cached state listing.
 * Returns [] when the bucket isn't loaded or doesn't apply.
 */
function currentBucketEntries(
  bucket: Bucket | undefined,
  classification: ReturnType<typeof classifyParentListing>,
  parentEntries: DropboxEntry[],
  stateListings: Record<string, StateListing>,
): DropboxEntry[] {
  if (!bucket) return [];
  if (bucket.kind === "inbox") {
    const map = new Map(parentEntries.map((e) => [e.path, e]));
    return classification.inbox
      .map((h) => map.get(h.path))
      .filter((e): e is DropboxEntry => e !== undefined);
  }
  const listing = stateListings[bucket.id];
  return listing && listing.kind === "ready" ? listing.entries : [];
}

function BucketChip({
  bucket,
  selected,
  onSelect,
  dragHover,
  onDragEnter,
  onDragLeave,
  onDrop,
}: {
  bucket: Bucket;
  selected: boolean;
  onSelect: () => void;
  dragHover: boolean;
  onDragEnter: () => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent<HTMLButtonElement>) => void;
}) {
  const countText =
    bucket.kind === "inbox"
      ? `${bucket.count}`
      : bucket.count === null
        ? "…"
        : `${bucket.count}`;
  const isTerminal = bucket.kind === "state" && bucket.state.terminal === true;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onSelect}
      // dragOver must preventDefault for the chip to be a valid drop
      // target. dropEffect = "move" so the cursor reflects what'll happen.
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-drop-hover={dragHover ? "true" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
        selected
          ? "border-foreground bg-foreground text-background"
          : "border-border bg-background hover:border-foreground/40",
        dragHover && "ring-2 ring-foreground/60 ring-offset-2",
      )}
    >
      <span className="font-medium">{bucket.name}</span>
      <span
        className={cn(
          "rounded-full px-1.5 py-0.5 text-xs",
          selected
            ? "bg-background/20"
            : "bg-muted text-muted-foreground",
        )}
      >
        {countText}
      </span>
      {isTerminal ? (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide",
            selected ? "bg-background/20" : "bg-muted text-muted-foreground",
          )}
          aria-label="terminal state"
        >
          end
        </span>
      ) : null}
    </button>
  );
}

type PromoteContext = {
  sourceBucket: BucketRef;
  destBucket: BucketRef;
  destStateName: string;
  destFolderPath: string;
};

type RenderArgs = {
  bucket: Bucket | undefined;
  classification: ReturnType<typeof classifyParentListing>;
  parentEntries: DropboxEntry[];
  stateListings: Record<string, StateListing>;
  onPreviewImage: (e: DropboxEntry) => void;
  onSaveFile: (e: DropboxEntry) => void;
  savingPath: string | null;
  onNavigateInto: (path: string) => void;
  renderEntryRow: PipelineViewProps["renderEntryRow"];
  promoteContext: PromoteContext | null;
  movingPaths: ReadonlySet<string>;
  onPromote: (entry: DropboxEntry) => void;
  /** BucketRef of the currently-rendered bucket; baked into drag payloads. */
  sourceBucketRef: BucketRef;
  /** Path of the row currently being dragged, so rendered rows can dim it. */
  draggingPath: string | null;
  onDragStart: (entry: DropboxEntry) => void;
  onDragEnd: () => void;
  /** Selection state for the currently-rendered bucket. */
  selectedPaths: ReadonlySet<string>;
  onToggleSelect: (entryPath: string) => void;
  /** Notes table snapshot, used to drive the per-row indicator dot. */
  notesByPath: NotesByPath;
  onOpenNote: (entry: DropboxEntry) => void;
  /** Active sort applied to the rendered bucket's contents. */
  sort: SortPreference;
};

function renderBucketContents(args: RenderArgs): ReactNode {
  const { bucket } = args;
  if (!bucket) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        No buckets to display.
      </p>
    );
  }

  if (bucket.kind === "inbox") {
    const inboxEntries = byPath(args.parentEntries, args.classification.inbox);
    return renderEntryList({ ...args, entries: inboxEntries, emptyMessage: "Inbox is empty." });
  }

  // bucket.kind === "state"
  const listing = args.stateListings[bucket.id];
  if (!listing || listing.kind === "loading") {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        Loading {bucket.name}…
      </p>
    );
  }
  if (listing.kind === "error") {
    return (
      <p
        role="alert"
        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      >
        {listing.message}
      </p>
    );
  }
  return renderEntryList({
    ...args,
    entries: listing.entries,
    emptyMessage: `${bucket.name} is empty.`,
  });
}

function renderEntryList(
  args: RenderArgs & { entries: DropboxEntry[]; emptyMessage: string },
) {
  if (args.entries.length === 0) {
    return (
      <p className="px-2 py-6 text-sm text-muted-foreground">
        {args.emptyMessage}
      </p>
    );
  }
  const sorted = sortEntries(args.entries, args.sort, {
    toSortable: dropboxEntryToSortable,
  });
  return (
    <ScrollArea className="h-[min(55vh,520px)] rounded-lg border">
      <ul className="flex flex-col gap-1 p-2">
        {sorted.map((entry) => {
          const promote = args.promoteContext
            ? {
                targetStateName: args.promoteContext.destStateName,
                inFlight: args.movingPaths.has(entry.path),
                onClick: () => args.onPromote(entry),
              }
            : undefined;
          const isDragging = args.draggingPath === entry.path;
          const isSelected = args.selectedPaths.has(entry.path);
          return (
            <li
              key={entry.path}
              draggable
              data-dragging={isDragging ? "true" : undefined}
              data-selected={isSelected ? "true" : undefined}
              className={cn(
                "rounded-md transition",
                isDragging && "opacity-40",
                isSelected && "bg-muted/40",
              )}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({
                    path: entry.path,
                    name: entry.name,
                    source: args.sourceBucketRef,
                  }),
                );
                e.dataTransfer.effectAllowed = "move";
                args.onDragStart(entry);
              }}
              onDragEnd={() => args.onDragEnd()}
            >
              {args.renderEntryRow(entry, {
                saving: args.savingPath === entry.path,
                onPreview: () => args.onPreviewImage(entry),
                onSave: () => args.onSaveFile(entry),
                onOpenFolder: () => args.onNavigateInto(entry.path),
                promote,
                select: {
                  selected: isSelected,
                  onToggle: () => args.onToggleSelect(entry.path),
                },
                note: {
                  hasNote: Boolean(args.notesByPath[entry.path]),
                  onClick: () => args.onOpenNote(entry),
                },
              })}
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}

function byPath(
  entries: DropboxEntry[],
  handles: EntryHandle[],
): DropboxEntry[] {
  const map = new Map(entries.map((e) => [e.path, e]));
  return handles
    .map((h) => map.get(h.path))
    .filter((e): e is DropboxEntry => e !== undefined);
}

/**
 * Strip the last path segment, returning the parent folder path.
 * Returns "" for paths with no parent (root-level entries).
 */
function parentFolderOfPath(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "" : p.substring(0, i);
}

/** Convert a fully-shaped Bucket into the minimal BucketRef discriminator. */
function bucketAsRef(b: Bucket): BucketRef {
  return b.kind === "inbox" ? { kind: "inbox" } : { kind: "state", id: b.id };
}

function sameBucketRef(a: BucketRef, b: BucketRef): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "inbox") return true;
  return a.id === (b as { kind: "state"; id: string }).id;
}

/**
 * Validate a drag-payload coming back through `dataTransfer.getData`.
 * Defensive because the value is opaque JSON — even though we wrote it
 * ourselves, there's no compile-time guarantee about its shape.
 */
type DragPayload = { path: string; name: string; source: BucketRef };
function isDragPayload(v: unknown): v is DragPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.name !== "string") return false;
  const src = o.source;
  if (!src || typeof src !== "object") return false;
  const s = src as Record<string, unknown>;
  if (s.kind === "inbox") return true;
  if (s.kind === "state" && typeof s.id === "string") return true;
  return false;
}
