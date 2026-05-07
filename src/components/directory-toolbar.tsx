import { ChevronUp, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DirectoryToolbarProps = {
  pathInput: string;
  onPathInputChange: (value: string) => void;
  onSubmit: () => void;
  onGoUp: () => void;
  onRefresh: () => void;
  loading: boolean;
  hasPath: boolean;
  error?: string | null;
  inputAriaLabel?: string;
  refreshAriaLabel?: string;
  inputPlaceholder?: string;
};

export function DirectoryToolbar({
  pathInput,
  onPathInputChange,
  onSubmit,
  onGoUp,
  onRefresh,
  loading,
  hasPath,
  error,
  inputAriaLabel = "Folder path",
  refreshAriaLabel = "Refresh listing",
  inputPlaceholder = "Enter a folder path",
}: DirectoryToolbarProps) {
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3 sm:flex-row sm:items-center"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <Input
          value={pathInput}
          onChange={(event) => onPathInputChange(event.currentTarget.value)}
          placeholder={inputPlaceholder}
          aria-label={inputAriaLabel}
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
            disabled={loading || !hasPath}
            onClick={onGoUp}
            aria-label="Parent folder"
          >
            <ChevronUp data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={loading || !hasPath}
            onClick={onRefresh}
            aria-label={refreshAriaLabel}
          >
            <RefreshCw data-icon="inline-start" />
          </Button>
        </div>
      </form>

      {error ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
