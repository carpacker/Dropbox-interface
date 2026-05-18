/**
 * Shared "Recent X" dashboard card. Each domain (pipelines, CRMs,
 * Job Trackers, future) ships its own persistence helper but uses
 * this component to render — keeps the visual language identical.
 *
 * Generic over `Entry` because each domain's recent shape adds
 * domain-specific fields (e.g. pipelines persist `visitedAt` *ms*,
 * CRMs the same — both work uniformly here via the props the caller
 * computes per row).
 *
 * Intentionally minimal: no sort, no filter, no MRU logic — those
 * are all on the caller's side. This component just renders rows
 * + pin toggles in whatever order it received them.
 */

import { History, Pin, PinOff, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type RecentsCardProps<Entry> = {
  /** Card heading text. */
  title: string;
  description: ReactNode;
  /** Optional override for the title icon; defaults to <History />. */
  icon?: LucideIcon;
  /**
   * Accessible label for the <ul>. Should be distinct from the
   * heading text so multiple recents cards can co-exist
   * (`screen.getByLabelText(...)` disambiguates).
   */
  ariaListLabel: string;
  entries: ReadonlyArray<Entry>;
  /** Stable id for React's `key`. */
  idFor: (entry: Entry) => string;
  /** Big title text on the row. */
  nameFor: (entry: Entry) => string;
  /** Small monospace path beneath the name. */
  pathFor: (entry: Entry) => string;
  /** Unix milliseconds; rendered as relative time on the right. */
  visitedAtFor: (entry: Entry) => number;
  pinnedFor: (entry: Entry) => boolean;
  /** Called when the user clicks the row body (not the pin). */
  onLaunch: (entry: Entry) => void;
  /** Called when the user clicks the pin toggle. */
  onTogglePin: (entry: Entry) => void;
  /** How to render the relative-time string in the row's right gutter. */
  formatRelativeTime: (visitedAt: number, now: number) => string;
};

export function RecentsCard<Entry>(props: RecentsCardProps<Entry>) {
  if (props.entries.length === 0) return null;
  const Icon = props.icon ?? History;
  const nowMs = Date.now();
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-col gap-2 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon />
          {props.title}
        </CardTitle>
        <CardDescription>{props.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul
          aria-label={props.ariaListLabel}
          className="flex flex-col gap-2"
        >
          {props.entries.map((entry) => {
            const pinned = props.pinnedFor(entry);
            const name = props.nameFor(entry);
            return (
              <li
                key={props.idFor(entry)}
                className={cn(
                  "flex items-stretch gap-1 rounded-lg border bg-background transition hover:border-foreground/40",
                  pinned && "border-foreground/30",
                )}
              >
                <button
                  type="button"
                  onClick={() => props.onLaunch(entry)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">
                      {name}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {props.pathFor(entry)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {props.formatRelativeTime(
                      props.visitedAtFor(entry),
                      nowMs,
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => props.onTogglePin(entry)}
                  aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
                  aria-pressed={pinned ? "true" : "false"}
                  className={cn(
                    "flex shrink-0 items-center justify-center px-3 transition hover:bg-muted",
                    pinned && "text-foreground",
                    !pinned && "text-muted-foreground",
                  )}
                >
                  {pinned ? <Pin /> : <PinOff />}
                </button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
