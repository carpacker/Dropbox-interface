import { Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type FilterChipProps = {
  value: string;
  onChange: (next: string) => void;
  /** Helps differentiate multiple chips on the same screen for tests + a11y. */
  label?: string;
  placeholder?: string;
  /** Number of items the chip filters; shown as a small badge when >0. */
  count?: number | null;
  className?: string;
};

/**
 * Compact text-input "chip" that filters a listing in real time.
 * Empty input is the inactive state (no badge, X button hidden).
 *
 * Filter state lives in the parent component; this is a controlled
 * input. Helpers in `lib/filter.ts` apply the value to entries.
 */
export function FilterChip({
  value,
  onChange,
  label = "Filter",
  placeholder = "Filter…",
  count,
  className,
}: FilterChipProps) {
  const trimmed = value.trim();
  const active = trimmed !== "";

  return (
    <div
      className={cn(
        "relative inline-flex h-8 items-center",
        className,
      )}
    >
      <Search
        className="pointer-events-none absolute left-2 size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-8 w-[12rem] pl-7 pr-7 text-xs"
      />
      {active ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Clear filter"
          onClick={() => onChange("")}
          className="absolute right-1 h-6 w-6"
        >
          <X data-icon="inline-start" className="size-3" />
        </Button>
      ) : null}
      {active && count !== null && count !== undefined ? (
        <span
          className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          aria-label={`${count} match${count === 1 ? "" : "es"}`}
        >
          {count}
        </span>
      ) : null}
    </div>
  );
}
