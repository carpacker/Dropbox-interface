import { ArrowDownAZ, ArrowDownNarrowWide, ArrowUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SortDirection, SortKey, SortPreference } from "@/lib/sort";

export type SortDropdownProps = {
  value: SortPreference;
  onChange: (next: SortPreference) => void;
  /**
   * Subset of keys to expose. Useful for surfaces that don't have
   * meaningful size/modified data (e.g. the Photos grid where size is
   * available but cluttering).
   */
  keys?: SortKey[];
  className?: string;
  /** Compact form for tight toolbars (drops the icon labels). */
  compact?: boolean;
};

const DEFAULT_KEYS: SortKey[] = ["name", "modified", "size"];

const KEY_LABELS: Record<SortKey, string> = {
  name: "Name",
  modified: "Modified",
  size: "Size",
};

/**
 * Two-control sort UI: a Select for the sort key, an icon button for
 * direction. Exposed as a single `value` / `onChange` pair so callers
 * can plug straight into a `useState<SortPreference>` or persist the
 * value via `loadSortPreference` / `saveSortPreference`.
 */
export function SortDropdown({
  value,
  onChange,
  keys = DEFAULT_KEYS,
  className,
  compact = false,
}: SortDropdownProps) {
  function flipDirection() {
    const next: SortDirection = value.direction === "asc" ? "desc" : "asc";
    onChange({ ...value, direction: next });
  }

  return (
    <div className={className} data-testid="sort-dropdown">
      <div className="flex items-center gap-1">
        {!compact ? (
          <span className="text-xs text-muted-foreground">Sort</span>
        ) : null}
        <Select
          value={value.key}
          onValueChange={(v) =>
            onChange({ ...value, key: v as SortKey })
          }
        >
          <SelectTrigger
            className="h-8 w-[7rem] text-xs"
            aria-label="Sort by"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {keys.map((k) => (
              <SelectItem key={k} value={k}>
                {KEY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label={
            value.direction === "asc"
              ? "Sort ascending (click to flip to descending)"
              : "Sort descending (click to flip to ascending)"
          }
          aria-pressed={value.direction === "desc" ? "true" : "false"}
          title={value.direction === "asc" ? "Ascending" : "Descending"}
          onClick={flipDirection}
        >
          {value.key === "name" ? (
            <ArrowDownAZ
              data-icon="inline-start"
              className={
                value.direction === "desc" ? "rotate-180" : undefined
              }
            />
          ) : value.direction === "asc" ? (
            <ArrowDownNarrowWide data-icon="inline-start" />
          ) : (
            <ArrowUpDown data-icon="inline-start" />
          )}
        </Button>
      </div>
    </div>
  );
}
