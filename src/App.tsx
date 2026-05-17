import {
  ArrowLeft,
  History,
  Pin,
  PinOff,
  Settings as SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { SettingsDialog } from "@/components/settings-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APPS, findApp } from "@/lib/apps/registry";
import type { AppContext, AppDeepLink } from "@/lib/apps/types";
import {
  getRecentPipelines,
  setPinned,
  type RecentPipeline,
} from "@/lib/pipeline-recents";
import {
  applyTheme,
  loadSettings,
  subscribeSettings,
  type DashboardLayout,
} from "@/lib/settings";
import { formatRelativeTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";

/**
 * Dashboard layout presets. The grid that hosts the app cards swaps
 * its Tailwind class string based on the user's settings choice.
 *
 *   stacked → 1 column, large cards
 *   grid    → responsive 1/2/3 columns (default)
 *   compact → tighter 2/3/4 columns
 */
const DASHBOARD_LAYOUT_CLASSES: Record<DashboardLayout, string> = {
  stacked: "grid gap-4",
  grid: "grid gap-4 md:grid-cols-2 xl:grid-cols-3",
  compact: "grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4",
};

/** Sentinel for "no app active; show the dashboard". */
const DASHBOARD_ID = "__dashboard__";

function App() {
  const [activeAppId, setActiveAppId] = useState<string>(DASHBOARD_ID);
  const [deepLink, setDeepLink] = useState<AppDeepLink | undefined>(undefined);
  const [recents, setRecents] = useState<RecentPipeline[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dashboardLayout, setDashboardLayout] = useState<DashboardLayout>(
    () => loadSettings().dashboardLayout,
  );

  // Apply theme + react to settings changes from the dialog. Theme
  // installs on mount and re-applies whenever the user picks a new
  // value (incl. tracking OS preference under "system").
  useEffect(() => {
    let teardown = applyTheme(loadSettings().theme);
    const unsub = subscribeSettings((next) => {
      teardown();
      teardown = applyTheme(next.theme);
      setDashboardLayout(next.dashboardLayout);
    });
    return () => {
      teardown();
      unsub();
    };
  }, []);

  // Re-read the recents list every time the dashboard becomes visible so
  // a freshly-visited pipeline shows up without a window reload.
  const onDashboard = activeAppId === DASHBOARD_ID;
  useEffect(() => {
    if (onDashboard) setRecents(getRecentPipelines());
  }, [onDashboard]);

  const goHome = useCallback(() => {
    setActiveAppId(DASHBOARD_ID);
    setDeepLink(undefined);
  }, []);

  /** Launch an app via its id, optionally threading a deep-link payload. */
  const launch = useCallback(
    (id: string, link?: AppDeepLink) => {
      setDeepLink(link);
      setActiveAppId(id);
    },
    [],
  );

  const activeApp = useMemo(
    () => (onDashboard ? null : findApp(activeAppId)),
    [onDashboard, activeAppId],
  );

  const title = onDashboard
    ? "Dashboard"
    : activeApp?.title ?? "Unknown app";

  const ctx: AppContext = { goHome, deepLink };

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-background p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">Dropbox Interface</h1>
        <p className="text-sm text-muted-foreground">
          Dashboard shell · React · TypeScript · shadcn/ui · Tauri
        </p>
      </header>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!onDashboard ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={goHome}
            >
              <ArrowLeft data-icon="inline-start" />
              Back to dashboard
            </Button>
          ) : null}
          <p className="text-sm font-medium">{title}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
          title="Settings"
        >
          <SettingsIcon data-icon="inline-start" />
        </Button>
      </div>

      {onDashboard ? (
        <div className="flex flex-col gap-4">
          <div
            aria-label="Dashboard apps"
            className={DASHBOARD_LAYOUT_CLASSES[dashboardLayout]}
          >
            {APPS.map((app) => {
              const Icon = app.dashboardCard.icon;
              const label =
                app.dashboardCard.launchLabel ?? `Open ${app.title}`;
              return (
                <Card key={app.id} className="flex flex-col">
                  <CardHeader className="flex flex-col gap-2">
                    <CardTitle className="flex items-center gap-2">
                      <Icon />
                      {app.title}
                    </CardTitle>
                    <CardDescription>
                      {app.dashboardCard.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button type="button" onClick={() => launch(app.id)}>
                      {label}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {recents.length > 0 ? (
            <Card className="flex flex-col">
              <CardHeader className="flex flex-col gap-2 pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <History />
                  Recent pipelines
                </CardTitle>
                <CardDescription>
                  Folders where a <code>.dropbox-interface.json</code> opened
                  last. Click to jump back in.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul
                  aria-label="Recent pipelines"
                  className="flex flex-col gap-2"
                >
                  {recents.map((r) => (
                    <li
                      key={r.path}
                      className={cn(
                        "flex items-stretch gap-1 rounded-lg border bg-background transition hover:border-foreground/40",
                        r.pinned && "border-foreground/30",
                      )}
                    >
                      <button
                        type="button"
                        // Recent pipelines today only target Dropbox.
                        // When a second backend (local) wants its own
                        // recents, the descriptor can declare which
                        // app to deep-link into.
                        onClick={() => launch("dropbox", r.path)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 px-3 py-2 text-left"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium">
                            {r.name}
                          </span>
                          <span className="truncate font-mono text-xs text-muted-foreground">
                            {r.path === "" ? "/ (root)" : r.path}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(r.visitedAt, Date.now())}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPinned(r.path, !r.pinned);
                          setRecents(getRecentPipelines());
                        }}
                        aria-label={
                          r.pinned ? `Unpin ${r.name}` : `Pin ${r.name}`
                        }
                        aria-pressed={r.pinned ? "true" : "false"}
                        className={cn(
                          "flex shrink-0 items-center justify-center px-3 transition hover:bg-muted",
                          r.pinned && "text-foreground",
                          !r.pinned && "text-muted-foreground",
                        )}
                      >
                        {r.pinned ? <Pin /> : <PinOff />}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : activeApp ? (
        <ErrorBoundary label={activeApp.title}>
          {activeApp.render(ctx)}
        </ErrorBoundary>
      ) : (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Unknown app id: <code>{activeAppId}</code>.
        </p>
      )}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
