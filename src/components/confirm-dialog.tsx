import { AlertTriangle, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  body: ReactNode;
  /** Confirm-button label (e.g. "Delete"). */
  confirmLabel: string;
  /** Cancel-button label. Defaults to "Cancel". */
  cancelLabel?: string;
  /** When true, the confirm button is rendered in destructive style. */
  destructive?: boolean;
  /** Disabled while the underlying action is in flight. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Modal confirmation dialog. Always shown over a backdrop; backdrop
 * click + Esc fire `onCancel`. Used today for Dropbox delete; reusable
 * for any future "are you sure" verb.
 *
 * Two-stage Esc isn't the right pattern here — this dialog is a
 * single-step gate, so Esc cancels and that's it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div
        className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-card p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          {destructive ? (
            <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <AlertTriangle className="size-4" aria-hidden />
            </div>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium">{title}</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onCancel}
                aria-label="Close"
                disabled={busy}
              >
                <X data-icon="inline-start" />
              </Button>
            </div>
            <div className="text-sm text-muted-foreground">{body}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
