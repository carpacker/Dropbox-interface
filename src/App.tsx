import {
  ArrowLeft,
  Settings as SettingsIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorBoundary } from "@/components/error-boundary";
import { RecentsCard } from "@/components/recents-card";
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
  getRecentCrms,
  setCrmPinned,
  type RecentCrm,
} from "@/lib/crm-recents";
import {
  getRecentJobTrackers,
  setJobTrackerPinned,
  type RecentJobTracker,
} from "@/lib/job-tracker-recents";
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
  const [crmRecents, setCrmRecents] = useState<RecentCrm[]>([]);
  const [jobRecents, setJobRecents] = useState<RecentJobTracker[]>([]);
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

  // Re-read recents whenever the dashboard becomes visible so
  // freshly-visited entries show up without a window reload.
  const onDashboard = activeAppId === DASHBOARD_ID;
  useEffect(() => {
    if (onDashboard) {
      setRecents(getRecentPipelines());
      setCrmRecents(getRecentCrms());
      setJobRecents(getRecentJobTrackers());
    }
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

  const ctx: AppContext = { goHome, launchApp: launch, deepLink };

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

          <RecentsCard<RecentPipeline>
            title="Recent pipelines"
            description={
              <>
                Folders where a <code>.dropbox-interface.json</code>{" "}
                opened last. Click to jump back in.
              </>
            }
            ariaListLabel="Recent pipelines"
            entries={recents}
            idFor={(r) => r.path}
            nameFor={(r) => r.name}
            pathFor={(r) => (r.path === "" ? "/ (root)" : r.path)}
            visitedAtFor={(r) => r.visitedAt}
            pinnedFor={(r) => Boolean(r.pinned)}
            onLaunch={(r) => launch("dropbox", r.path)}
            onTogglePin={(r) => {
              setPinned(r.path, !r.pinned);
              setRecents(getRecentPipelines());
            }}
            formatRelativeTime={formatRelativeTime}
          />

          <RecentsCard<RecentCrm>
            title="Recent CRMs"
            description="Folders you've opened in the CRM app. Click to jump back in."
            ariaListLabel="Recent CRMs"
            entries={crmRecents}
            idFor={(r) => r.path}
            nameFor={(r) => r.name}
            pathFor={(r) => r.path}
            visitedAtFor={(r) => r.visitedAt}
            pinnedFor={(r) => Boolean(r.pinned)}
            onLaunch={(r) => launch("crm", r.path)}
            onTogglePin={(r) => {
              setCrmPinned(r.path, !r.pinned);
              setCrmRecents(getRecentCrms());
            }}
            formatRelativeTime={formatRelativeTime}
          />

          <RecentsCard<RecentJobTracker>
            title="Recent Job Trackers"
            description="Folders you've opened in the Job Tracker app. Click to jump back in."
            ariaListLabel="Recent Job Trackers"
            entries={jobRecents}
            idFor={(r) => r.path}
            nameFor={(r) => r.name}
            pathFor={(r) => r.path}
            visitedAtFor={(r) => r.visitedAt}
            pinnedFor={(r) => Boolean(r.pinned)}
            onLaunch={(r) => launch("job-tracker", r.path)}
            onTogglePin={(r) => {
              setJobTrackerPinned(r.path, !r.pinned);
              setJobRecents(getRecentJobTrackers());
            }}
            formatRelativeTime={formatRelativeTime}
          />
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
