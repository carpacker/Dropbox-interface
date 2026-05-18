/**
 * Two-state segmented toggle (e.g. List ↔ Tile, List ↔ Gallery).
 *
 * Generic over the value type because each surface picks its own
 * vocabulary: pipelines toggle between `"list"` and `"gallery"`
 * (defined in `lib/view-mode.ts`); flat browsers toggle between
 * `"list"` and `"tile"` (defined in `lib/browser-view-mode.ts`).
 * Sharing the rendering keeps the visual language consistent
 * without forcing the storage layer to agree on a vocabulary.
 */

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

export type ViewModeOption<T extends string> = {
  value: T;
  icon: LucideIcon;
  /** Short label shown on `sm+`. */
  label: string;
  /** Accessible label; defaults to `${label} view`. */
  ariaLabel?: string;
};

export type ViewModeToggleProps<T extends string> = {
  value: T;
  options: [ViewModeOption<T>, ViewModeOption<T>];
  onChange: (next: T) => void;
  /** Wrapping group label; defaults to "View mode". */
  groupLabel?: string;
};

export function ViewModeToggle<T extends string>({
  value,
  options,
  onChange,
  groupLabel = "View mode",
}: ViewModeToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="inline-flex h-8 items-center overflow-hidden rounded-md border"
    >
      {options.map((opt, idx) => {
        const Icon = opt.icon;
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-label={opt.ariaLabel ?? `${opt.label} view`}
            aria-pressed={selected}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex h-8 items-center gap-1 px-2 text-xs",
              idx > 0 && "border-l",
              selected
                ? "bg-foreground text-background"
                : "bg-background text-foreground hover:bg-muted",
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
