import { Check, Monitor, Moon, Settings as SettingsIcon, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  applyTheme,
  loadSettings,
  saveSettings,
  type DashboardLayout,
  type Settings,
  type Theme,
} from "@/lib/settings";
import { cn } from "@/lib/utils";

const THEME_OPTIONS: Array<{
  value: Theme;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "light",
    label: "Light",
    description: "Always use the light palette.",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Always use the dark palette.",
    icon: Moon,
  },
  {
    value: "system",
    label: "System",
    description: "Match your OS preference and follow it as it changes.",
    icon: Monitor,
  },
];

const LAYOUT_OPTIONS: Array<{
  value: DashboardLayout;
  label: string;
  description: string;
  preview: ReactNode;
}> = [
  {
    value: "stacked",
    label: "Stacked",
    description: "Single column. Big cards, easiest to scan.",
    preview: <LayoutPreview rows={3} cols={1} />,
  },
  {
    value: "grid",
    label: "Grid",
    description: "Auto-fit responsive grid. The standard.",
    preview: <LayoutPreview rows={1} cols={3} />,
  },
  {
    value: "compact",
    label: "Compact",
    description: "Denser, smaller cards for a power-user dashboard.",
    preview: <LayoutPreview rows={2} cols={4} />,
  },
];

export type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
};

/**
 * Modal settings dialog. Controlled by App.tsx via `open`.
 *
 * Writes are immediate — every option calls `saveSettings(...)` on
 * change, so there's no Save/Cancel; the X button just closes.
 * `applyTheme` is invoked alongside the theme write so the swap is
 * instant.
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());

  // Re-read from storage whenever the dialog opens, in case another
  // path changed it (defensive — there's only one writer today).
  useEffect(() => {
    if (open) setSettings(loadSettings());
  }, [open]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function setTheme(theme: Theme) {
    const next = { ...settings, theme };
    setSettings(next);
    saveSettings(next);
    applyTheme(theme);
  }
  function setLayout(dashboardLayout: DashboardLayout) {
    const next = { ...settings, dashboardLayout };
    setSettings(next);
    saveSettings(next);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div
        className="flex w-full max-w-xl flex-col gap-4 rounded-lg border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <SettingsIcon className="mt-0.5 size-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Settings</p>
              <p className="text-xs text-muted-foreground">
                Choices are saved automatically and apply to every workspace.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close settings"
          >
            <X data-icon="inline-start" />
          </Button>
        </div>

        <Section heading="Theme">
          <div role="radiogroup" aria-label="Theme" className="flex flex-col gap-2">
            {THEME_OPTIONS.map((opt) => (
              <OptionRow
                key={opt.value}
                selected={settings.theme === opt.value}
                onSelect={() => setTheme(opt.value)}
                ariaLabel={`Theme: ${opt.label}`}
              >
                <opt.icon className="size-4 text-muted-foreground" aria-hidden />
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </div>
              </OptionRow>
            ))}
          </div>
        </Section>

        <Section heading="Dashboard layout">
          <div
            role="radiogroup"
            aria-label="Dashboard layout"
            className="grid grid-cols-1 gap-2 sm:grid-cols-3"
          >
            {LAYOUT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={settings.dashboardLayout === opt.value}
                aria-label={`Dashboard layout: ${opt.label}`}
                onClick={() => setLayout(opt.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border p-2 text-left transition",
                  settings.dashboardLayout === opt.value
                    ? "border-foreground bg-muted/40"
                    : "hover:border-foreground/40",
                )}
              >
                <div className="rounded bg-background p-1.5">{opt.preview}</div>
                <div>
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {opt.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {heading}
      </p>
      {children}
    </section>
  );
}

function OptionRow({
  selected,
  onSelect,
  ariaLabel,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
        selected
          ? "border-foreground bg-muted/40"
          : "hover:border-foreground/40",
      )}
    >
      {children}
      {selected ? (
        <Check
          data-icon="inline-start"
          aria-hidden
          className="ml-auto size-4 shrink-0 text-foreground"
        />
      ) : null}
    </button>
  );
}

/**
 * Tiny SVG-free preview block for the dashboard layout choices.
 * Renders a `rows × cols` grid of bars roughly proportional to a
 * card. Pure presentational; no data needed.
 */
function LayoutPreview({ rows, cols }: { rows: number; cols: number }) {
  const cells = rows * cols;
  return (
    <div
      aria-hidden
      className="grid w-full gap-1"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, 1.25rem)`,
      }}
    >
      {Array.from({ length: cells }).map((_, i) => (
        <div key={i} className="rounded-sm bg-muted-foreground/20" />
      ))}
    </div>
  );
}
