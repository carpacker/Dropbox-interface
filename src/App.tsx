import {
  ArrowLeft,
  Cloud,
  FolderOpen,
  History,
  MonitorCog,
  Pin,
  PinOff,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DesktopWorkspaceApp } from "@/components/desktop-workspace-app";
import { DropboxApp } from "@/components/dropbox-app";
import { ErrorBoundary } from "@/components/error-boundary";
import { PhotosApp } from "@/components/photos-app";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getRecentPipelines,
  setPinned,
  type RecentPipeline,
} from "@/lib/pipeline-recents";
import { formatRelativeTime } from "@/lib/time-format";
import { cn } from "@/lib/utils";

type AppId = "dashboard" | "workspace" | "photos" | "dropbox";

function App() {
  const [activeApp, setActiveApp] = useState<AppId>("dashboard");
  const [dropboxInitialPath, setDropboxInitialPath] = useState<
    string | undefined
  >(undefined);
  const [recents, setRecents] = useState<RecentPipeline[]>([]);

  // Re-read the recents list every time the dashboard becomes visible so
  // a freshly-visited pipeline shows up without a window reload.
  useEffect(() => {
    if (activeApp === "dashboard") {
      setRecents(getRecentPipelines());
    }
  }, [activeApp]);

  const title = useMemo(() => {
    switch (activeApp) {
      case "workspace":
        return "Desktop Workspace";
      case "photos":
        return "Photos";
      case "dropbox":
        return "Dropbox";
      default:
        return "Dashboard";
    }
  }, [activeApp]);

  function openDropboxAt(path: string | undefined) {
    setDropboxInitialPath(path);
    setActiveApp("dropbox");
  }

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
          {activeApp !== "dashboard" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setActiveApp("dashboard")}
            >
              <ArrowLeft data-icon="inline-start" />
              Back to dashboard
            </Button>
          ) : null}
          <p className="text-sm font-medium">{title}</p>
        </div>
      </div>

      {activeApp === "dashboard" ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card className="flex flex-col">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="flex items-center gap-2">
                  <MonitorCog />
                  Desktop Workspace
                </CardTitle>
                <CardDescription>
                  Open the desktop shell and browse folders inside a single app.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => setActiveApp("workspace")}>
                  Launch workspace app
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="flex items-center gap-2">
                  <FolderOpen />
                  Photo Viewer
                </CardTitle>
                <CardDescription>
                  Browse directories and preview supported image files quickly.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => setActiveApp("photos")}>
                  Open photo app
                </Button>
              </CardContent>
            </Card>

            <Card className="flex flex-col">
              <CardHeader className="flex flex-col gap-2">
                <CardTitle className="flex items-center gap-2">
                  <Cloud />
                  Dropbox
                </CardTitle>
                <CardDescription>
                  Connect your Dropbox account and browse remote folders.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button type="button" onClick={() => openDropboxAt(undefined)}>
                  Open Dropbox
                </Button>
              </CardContent>
            </Card>
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
                        onClick={() => openDropboxAt(r.path)}
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
                          r.pinned
                            ? `Unpin ${r.name}`
                            : `Pin ${r.name}`
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
      ) : null}

      {activeApp === "workspace" ? (
        <ErrorBoundary label="Desktop Workspace">
          <DesktopWorkspaceApp />
        </ErrorBoundary>
      ) : null}
      {activeApp === "photos" ? (
        <ErrorBoundary label="Photos">
          <PhotosApp />
        </ErrorBoundary>
      ) : null}
      {activeApp === "dropbox" ? (
        <ErrorBoundary label="Dropbox">
          <DropboxApp initialPath={dropboxInitialPath} />
        </ErrorBoundary>
      ) : null}
    </div>
  );
}

export default App;
