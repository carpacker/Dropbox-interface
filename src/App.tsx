import {
  ArrowLeft,
  ChevronRight,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  GripVertical,
  Link2,
  Lock,
  LockOpen,
  MonitorCog,
  RotateCcw,
  Settings2,
} from "lucide-react";
import { type ComponentType, useEffect, useMemo, useState } from "react";

import { DesktopWorkspaceApp } from "@/components/desktop-workspace-app";
import { DropboxBrowserApp } from "@/components/dropbox-browser-app";
import { PhotosApp } from "@/components/photos-app";
import { WebInterfaceApp } from "@/components/web-interface-app";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { webBridgeSetDashboardState, webBridgeTakeOpenAppCommand } from "@/lib/web-bridge";

const DASHBOARD_LAYOUT_KEY = "dropbox-interface:dashboard-layout-v1";
const DASHBOARD_EDIT_LOCK_KEY = "dropbox-interface:dashboard-edit-locked";

type AppKey = "workspace" | "photos" | "dropbox" | "web";
type ActiveApp = "dashboard" | AppKey;
type CardSize = "compact" | "wide" | "tall";

type AppDefinition = {
  key: AppKey;
  title: string;
  description: string;
  launchLabel: string;
  icon: ComponentType<{ className?: string }>;
};

type DashboardLayout = {
  order: AppKey[];
  sizes: Record<AppKey, CardSize>;
};

const DEFAULT_ORDER: AppKey[] = ["workspace", "photos", "dropbox", "web"];
const DEFAULT_SIZES: Record<AppKey, CardSize> = {
  workspace: "wide",
  photos: "compact",
  dropbox: "compact",
  web: "compact",
};

const APP_DEFINITIONS: AppDefinition[] = [
  {
    key: "workspace",
    title: "Desktop Workspace",
    description: "Open the desktop shell and browse folders inside a single app.",
    launchLabel: "Launch workspace app",
    icon: MonitorCog,
  },
  {
    key: "photos",
    title: "Photo Viewer",
    description: "Browse directories and preview supported image files quickly.",
    launchLabel: "Open photo app",
    icon: FolderOpen,
  },
  {
    key: "web",
    title: "Web Interface",
    description: "Configure a browser/web-client bridge profile for this desktop app.",
    launchLabel: "Open web interface",
    icon: Globe,
  },
  {
    key: "dropbox",
    title: "Dropbox Explorer",
    description: "Connect with Dropbox token and browse cloud files/folders.",
    launchLabel: "Open Dropbox app",
    icon: Link2,
  },
];

function restoreLayout(): DashboardLayout {
  const fallback: DashboardLayout = {
    order: [...DEFAULT_ORDER],
    sizes: { ...DEFAULT_SIZES },
  };
  const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardLayout>;
    const inputOrder = Array.isArray(parsed.order) ? parsed.order : [];
    const deduped = inputOrder.filter((key, idx) => inputOrder.indexOf(key) === idx);
    const validOrder = deduped.filter(
      (key): key is AppKey => DEFAULT_ORDER.includes(key as AppKey),
    );
    const missing = DEFAULT_ORDER.filter((key) => !validOrder.includes(key));
    const order = [...validOrder, ...missing];
    const sizes = { ...DEFAULT_SIZES, ...(parsed.sizes ?? {}) } as Record<AppKey, CardSize>;
    return { order, sizes };
  } catch {
    return fallback;
  }
}

function persistLayout(layout: DashboardLayout) {
  localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
}

function App() {
  const [activeApp, setActiveApp] = useState<ActiveApp>("dashboard");
  const [layout, setLayout] = useState<DashboardLayout>(() => restoreLayout());
  const [editMode, setEditMode] = useState(false);
  const [layoutLocked, setLayoutLocked] = useState(
    () => localStorage.getItem(DASHBOARD_EDIT_LOCK_KEY) !== "false",
  );
  const [draggingApp, setDraggingApp] = useState<AppKey | null>(null);

  const title = useMemo(() => {
    switch (activeApp) {
      case "workspace":
        return "Desktop Workspace";
      case "photos":
        return "Photos";
      case "dropbox":
        return "Dropbox Explorer";
      case "web":
        return "Web Interface";
      default:
        return "Dashboard";
    }
  }, [activeApp]);

  const orderedApps = useMemo(() => {
    const byKey = new Map(APP_DEFINITIONS.map((app) => [app.key, app]));
    return layout.order.map((key) => byKey.get(key)).filter(Boolean) as AppDefinition[];
  }, [layout.order]);

  useEffect(() => {
    void webBridgeSetDashboardState({
      activeApp,
      editMode,
      layoutLocked,
      layout,
      orderedApps: orderedApps.map((app) => app.key),
      publishedAt: Date.now(),
    }).catch(() => {});
  }, [activeApp, editMode, layoutLocked, layout, orderedApps]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void webBridgeTakeOpenAppCommand()
        .then((cmd) => {
          if (!cmd) return;
          const next = cmd as ActiveApp;
          if (
            next === "dashboard" ||
            next === "workspace" ||
            next === "photos" ||
            next === "dropbox" ||
            next === "web"
          ) {
            setActiveApp(next);
          }
        })
        .catch(() => {});
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  function moveCard(fromKey: AppKey, toKey: AppKey) {
    if (fromKey === toKey) return;
    const next = [...layout.order];
    const fromIdx = next.indexOf(fromKey);
    const toIdx = next.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromKey);
    const updated = { ...layout, order: next };
    setLayout(updated);
    persistLayout(updated);
  }

  function updateCardSize(key: AppKey, size: CardSize) {
    const updated = {
      ...layout,
      sizes: { ...layout.sizes, [key]: size },
    };
    setLayout(updated);
    persistLayout(updated);
  }

  function resetLayout() {
    const next = restoreLayout();
    next.order = [...DEFAULT_ORDER];
    next.sizes = { ...DEFAULT_SIZES };
    setLayout(next);
    persistLayout(next);
  }

  function toggleLayoutLock() {
    const next = !layoutLocked;
    setLayoutLocked(next);
    localStorage.setItem(DASHBOARD_EDIT_LOCK_KEY, next ? "true" : "false");
  }

  function cardSpanClass(key: AppKey) {
    const size = layout.sizes[key];
    if (size === "wide") return "md:col-span-2";
    if (size === "tall") return "md:row-span-2";
    return "";
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
        {activeApp === "dashboard" ? (
          <Button
            type="button"
            variant={editMode ? "secondary" : "outline"}
            size="sm"
            onClick={() => setEditMode((prev) => !prev)}
          >
            <Settings2 data-icon="inline-start" />
            {editMode ? "Done editing" : "Edit dashboard"}
          </Button>
        ) : null}
      </div>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center gap-2 py-2">
          <div className="flex items-center gap-1">
            <FileText className="text-muted-foreground" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("dashboard")}>
              File
            </Button>
            <ChevronRight className="text-muted-foreground size-3" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("web")}>
              Open Web Interface
            </Button>
          </div>
          <Separator className="hidden h-5 md:block" orientation="vertical" />
          <div className="flex items-center gap-1">
            <Edit3 className="text-muted-foreground" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditMode((prev) => !prev)}>
              {editMode ? "Exit Edit" : "Edit"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={toggleLayoutLock}>
              {layoutLocked ? "Unlock Layout" : "Lock Layout"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetLayout}>
              Reset Layout
            </Button>
          </div>
          <Separator className="hidden h-5 md:block" orientation="vertical" />
          <div className="flex items-center gap-1">
            <Eye className="text-muted-foreground" />
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("workspace")}>
              Workspace
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("photos")}>
              Photos
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("dropbox")}>
              Dropbox
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveApp("web")}>
              Web
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeApp === "dashboard" ? (
        <>
          {editMode ? (
            <Card size="sm">
              <CardHeader className="border-b">
                <CardTitle>Dashboard edit mode</CardTitle>
                <CardDescription>
                  Reorder tiles by dragging, resize cards, lock layout, or reset defaults.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-2 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleLayoutLock}
                >
                  {layoutLocked ? <Lock data-icon="inline-start" /> : <LockOpen data-icon="inline-start" />}
                  {layoutLocked ? "Unlock layout" : "Lock layout"}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={resetLayout}>
                  <RotateCcw data-icon="inline-start" />
                  Reset layout
                </Button>
                <p className="text-xs text-muted-foreground">
                  {layoutLocked ? "Layout is locked" : "Layout unlocked for drag/reorder"}
                </p>
              </CardContent>
            </Card>
          ) : null}
          <div className="grid gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-2 xl:grid-cols-3">
          {orderedApps.map((app) => {
            const Icon = app.icon;
            const isDragging = draggingApp === app.key;
            const canDrag = editMode && !layoutLocked;
            return (
              <Card
                key={app.key}
                draggable={canDrag}
                onDragStart={() => {
                  if (canDrag) setDraggingApp(app.key);
                }}
                onDragEnd={() => setDraggingApp(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingApp && canDrag) {
                    moveCard(draggingApp, app.key);
                  }
                  setDraggingApp(null);
                }}
                className={`${cardSpanClass(app.key)} flex flex-col transition ${
                  isDragging ? "opacity-60 ring-2 ring-primary/60" : "hover:ring-primary/30"
                }`}
              >
                <CardHeader className="flex flex-col gap-2">
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Icon />
                      {app.title}
                    </span>
                    <span className={`text-muted-foreground ${canDrag ? "" : "opacity-35"}`}>
                      <GripVertical />
                    </span>
                  </CardTitle>
                  <CardDescription>{app.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <Button type="button" onClick={() => setActiveApp(app.key)}>
                    {app.launchLabel}
                  </Button>
                  <div className="flex items-center gap-2">
                    {editMode ? (
                      <Select
                        value={layout.sizes[app.key]}
                        onValueChange={(value) => updateCardSize(app.key, value as CardSize)}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue placeholder="Tile size" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            <SelectLabel>Tile size</SelectLabel>
                            <SelectItem value="compact">Compact</SelectItem>
                            <SelectItem value="wide">Wide</SelectItem>
                            <SelectItem value="tall">Tall</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {canDrag ? "Drag to reorder" : "Enable edit mode to rearrange"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        </>
      ) : null}

      {activeApp === "workspace" ? <DesktopWorkspaceApp /> : null}
      {activeApp === "photos" ? <PhotosApp /> : null}
      {activeApp === "dropbox" ? <DropboxBrowserApp /> : null}
      {activeApp === "web" ? <WebInterfaceApp /> : null}
    </div>
  );
}

export default App;
