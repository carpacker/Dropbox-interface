/**
 * Row component used by the local-FS pipeline view. Mirrors the shape of
 * the Dropbox `EntryRow` (file/folder icon, name, size, modified time,
 * Promote / Note / multi-select affordances) but skips Dropbox-specific
 * features (thumbnails, Save-to-disk via Dropbox dialog, Delete behind
 * the Dropbox confirm modal).
 *
 * The row stays minimal on purpose: the local pipeline lives next to the
 * file browser, and the user has direct filesystem access — they don't
 * need an in-app "save to disk" or a destructive in-app delete (that
 * surface should land deliberately, see THREAT_MODEL §D8e).
 */

import { ArrowRight, File, Folder, MessageSquare } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PipelineEntry } from "@/lib/pipeline/entry";
import { formatBytes } from "@/lib/sort";
import { formatRelativeTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";

export type LocalEntryRowProps = {
  entry: PipelineEntry;
  onOpenFolder: (path: string) => void;
  promote?: {
    targetStateName: string;
    inFlight: boolean;
    onClick: () => void;
  };
  select?: {
    selected: boolean;
    onToggle: () => void;
  };
  note?: {
    hasNote: boolean;
    onClick: () => void;
  };
};

export function LocalEntryRow({
  entry,
  onOpenFolder,
  promote,
  select,
  note,
}: LocalEntryRowProps) {
  const isFolder = entry.kind === "folder";

  function handleMainClick() {
    if (isFolder) onOpenFolder(entry.path);
  }

  return (
    <div className="flex items-center gap-1.5">
      {select ? (
        <input
          type="checkbox"
          checked={select.selected}
          onChange={select.onToggle}
          aria-label={`Select ${entry.name}`}
          className="ml-1 h-4 w-4 shrink-0 cursor-pointer"
        />
      ) : null}
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-normal"
        disabled={!isFolder}
        onClick={handleMainClick}
        aria-label={isFolder ? `Open folder ${entry.name}` : entry.name}
      >
        {isFolder ? (
          <Folder data-icon="inline-start" />
        ) : (
          <File data-icon="inline-start" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
        {entry.size !== null && entry.size !== undefined ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatBytes(entry.size)}
          </span>
        ) : null}
        {entry.serverModified ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(entry.serverModified, Date.now())}
          </span>
        ) : null}
      </Button>
      {promote ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={promote.inFlight}
          onClick={promote.onClick}
          aria-label={`Promote ${entry.name} to ${promote.targetStateName}`}
          title={`Promote to ${promote.targetStateName}`}
        >
          <ArrowRight data-icon="inline-start" />
          <span className="hidden sm:inline">
            {promote.inFlight ? "Moving…" : promote.targetStateName}
          </span>
        </Button>
      ) : null}
      {note ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={note.onClick}
          aria-label={
            note.hasNote
              ? `Edit note for ${entry.name}`
              : `Add note for ${entry.name}`
          }
          aria-pressed={note.hasNote ? "true" : "false"}
          title={note.hasNote ? "Edit note" : "Add note"}
          className={cn("relative")}
        >
          <MessageSquare data-icon="inline-start" />
          {note.hasNote ? (
            <span
              data-testid={`note-indicator-${entry.path}`}
              aria-hidden="true"
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-foreground"
            />
          ) : null}
        </Button>
      ) : null}
    </div>
  );
}
