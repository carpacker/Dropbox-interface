import { ArrowLeft, FolderOpen, Link2, MonitorCog } from "lucide-react";
import { useMemo, useState } from "react";

import { DesktopWorkspaceApp } from "@/components/desktop-workspace-app";
import { DropboxBrowserApp } from "@/components/dropbox-browser-app";
import { PhotosApp } from "@/components/photos-app";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function App() {
  const [activeApp, setActiveApp] = useState<
    "dashboard" | "workspace" | "photos" | "dropbox"
  >(
    "dashboard",
  );

  const title = useMemo(() => {
    switch (activeApp) {
      case "workspace":
        return "Desktop Workspace";
      case "photos":
        return "Photos";
      case "dropbox":
        return "Dropbox Explorer";
      default:
        return "Dashboard";
    }
  }, [activeApp]);

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
                <Link2 />
                Dropbox Explorer
              </CardTitle>
              <CardDescription>
                Connect with Dropbox token and browse cloud files/folders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button type="button" onClick={() => setActiveApp("dropbox")}>
                Open Dropbox app
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeApp === "workspace" ? <DesktopWorkspaceApp /> : null}
      {activeApp === "photos" ? <PhotosApp /> : null}
      {activeApp === "dropbox" ? <DropboxBrowserApp /> : null}
    </div>
  );
}

export default App;
