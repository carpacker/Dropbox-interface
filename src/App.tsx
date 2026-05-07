import {
  ArrowLeft,
  Edit3,
  Eye,
  FolderOpen,
  Globe,
  GripVertical,
  Home,
  LayoutDashboard,
  Link2,
  Lock,
  LockOpen,
  MonitorCog,
  RotateCcw,
  Sparkles,
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
import {
  webBridgeSetDashboardState,
  webBridgeTakeDashboardEditCommand,
  webBridgeTakeOpenAppCommand,
} from "@/lib/web-bridge";

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
    () => localStorage.getItem(DASHBOARD_EDIT_LOCK_KEY) === "true",
  );
  const [draggingApp, setDraggingApp] = useState<AppKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<AppKey | null>(null);

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

      void webBridgeTakeDashboardEditCommand()
        .then((cmd) => {
          if (!cmd) return;

          if (typeof cmd.editMode === "boolean") {
            setEditMode(cmd.editMode);
            if (!cmd.editMode) {
              endDragSession();
            }
          }

          if (typeof cmd.layoutLocked === "boolean") {
            setLayoutLocked(cmd.layoutLocked);
            localStorage.setItem(DASHBOARD_EDIT_LOCK_KEY, cmd.layoutLocked ? "true" : "false");
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

  function endDragSession() {
    setDraggingApp(null);
    setDragOverKey(null);
  }

  return (
    <div className="relative flex min-h-screen flex-col gap-6 bg-gradient-to-b from-primary/[0.06] via-background to-background p-4 sm:p-6">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in oklch, var(--primary) 14%, transparent), transparent)",
        }}
        aria-hidden
      />

      <header className="mx-auto flex w-full max-w-6xl flex-col gap-4 rounded-2xl border border-border/60 bg-card/70 px-4 py-4 shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-card/50 dark:ring-white/10 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <LayoutDashboard className="size-5" aria-hidden />
          </div>
          <div className="min-w-0 space-y-0.5">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              Dropbox Interface
            </h1>
            <p className="text-muted-foreground text-xs sm:text-sm">
              Local workspace, photos, Dropbox, and a web bridge — one desktop shell.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {activeApp !== "dashboard" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shadow-sm"
              onClick={() => setActiveApp("dashboard")}
            >
              <ArrowLeft data-icon="inline-start" />
              Dashboard
            </Button>
          ) : null}
          {activeApp === "dashboard" ? (
            <>
              <Button
                type="button"
                variant={editMode ? "default" : "outline"}
                size="sm"
                className="shadow-sm"
                onClick={() => setEditMode((prev) => !prev)}
              >
                <Edit3 data-icon="inline-start" />
                {editMode ? "Done" : "Edit layout"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shadow-sm"
                onClick={toggleLayoutLock}
                title={layoutLocked ? "Unlock to allow dragging tiles" : "Lock to prevent accidental moves"}
              >
                {layoutLocked ? <Lock data-icon="inline-start" /> : <LockOpen data-icon="inline-start" />}
                {layoutLocked ? "Locked" : "Unlocked"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shadow-sm"
                onClick={resetLayout}
              >
                <RotateCcw data-icon="inline-start" />
                Reset
              </Button>
              <Separator className="hidden h-8 sm:block" orientation="vertical" />
              <div className="flex flex-wrap gap-1 rounded-lg border border-border/70 bg-muted/30 p-1 dark:bg-muted/15">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={() => setActiveApp("dashboard")}
                >
                  <Home className="size-4" />
                  <span className="ml-1 hidden md:inline">Home</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={() => setActiveApp("workspace")}
                >
                  <MonitorCog className="size-4" />
                  <span className="ml-1 hidden md:inline">Workspace</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={() => setActiveApp("photos")}
                >
                  <FolderOpen className="size-4" />
                  <span className="ml-1 hidden md:inline">Photos</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={() => setActiveApp("dropbox")}
                >
                  <Link2 className="size-4" />
                  <span className="ml-1 hidden md:inline">Dropbox</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2.5"
                  onClick={() => setActiveApp("web")}
                >
                  <Globe className="size-4" />
                  <span className="ml-1 hidden md:inline">Web</span>
                </Button>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Eye className="size-4 shrink-0" aria-hidden />
              <span className="font-medium text-foreground">{title}</span>
            </div>
          )}
        </div>
      </header>

      {activeApp === "dashboard" ? (
        <>
          {editMode ? (
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-3 rounded-xl border border-dashed border-primary/35 bg-primary/5 px-4 py-3 text-sm dark:bg-primary/10">
              <Sparkles className="size-4 shrink-0 text-primary" aria-hidden />
              <p className="text-muted-foreground min-w-[12rem] flex-1">
                {layoutLocked ? (
                  <>
                    <span className="font-medium text-foreground">Layout is locked.</span> Unlock to drag
                    tiles by the grip handle.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">Drag the grip</span> on each tile to
                    reorder. Lock when you are happy with the layout.
                  </>
                )}
              </p>
            </div>
          ) : null}
          <div className="mx-auto grid w-full max-w-6xl gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-2 xl:grid-cols-3">
          {orderedApps.map((app) => {
            const Icon = app.icon;
            const isDragging = draggingApp === app.key;
            const isDropTarget = Boolean(draggingApp && dragOverKey === app.key && draggingApp !== app.key);
            const canDrag = editMode && !layoutLocked;
            return (
              <Card
                key={app.key}
                onDragOver={(e) => {
                  if (!draggingApp || !canDrag) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverKey(app.key);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDragOverKey((prev) => (prev === app.key ? null : prev));
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingApp && canDrag) {
                    moveCard(draggingApp, app.key);
                  }
                  endDragSession();
                }}
                className={`${cardSpanClass(app.key)} flex flex-col shadow-sm ring-1 ring-black/[0.04] transition-[box-shadow,transform,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-md dark:ring-white/[0.06] ${
                  isDragging ? "scale-[0.99] opacity-60 ring-2 ring-primary/50" : ""
                } ${isDropTarget ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
              >
                <CardHeader className="flex flex-col gap-2">
                  <CardTitle className="flex items-start justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <span className="truncate leading-snug">{app.title}</span>
                    </span>
                    <span
                      role="button"
                      tabIndex={canDrag ? 0 : -1}
                      draggable={canDrag}
                      aria-label={canDrag ? `Drag to reorder ${app.title}` : "Enable edit layout and unlock to reorder"}
                      title={canDrag ? "Drag to reorder" : editMode ? "Unlock layout to reorder" : "Edit layout to reorder"}
                      className={`text-muted-foreground -mr-1 -mt-0.5 inline-flex shrink-0 rounded-md p-1.5 touch-none select-none ${
                        canDrag
                          ? "cursor-grab active:cursor-grabbing hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                          : "cursor-not-allowed opacity-40"
                      }`}
                      onKeyDown={(e) => {
                        if (!canDrag) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                        }
                      }}
                      onDragStart={(e) => {
                        if (!canDrag) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", app.key);
                        setDraggingApp(app.key);
                      }}
                      onDragEnd={endDragSession}
                    >
                      <GripVertical className="size-5" aria-hidden />
                    </span>
                  </CardTitle>
                  <CardDescription>{app.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <Button type="button" className="shadow-sm" onClick={() => setActiveApp(app.key)}>
                    {app.launchLabel}
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                    {editMode ? (
                      <Select
                        value={layout.sizes[app.key]}
                        onValueChange={(value) => updateCardSize(app.key, value as CardSize)}
                      >
                        <SelectTrigger className="w-full sm:w-36">
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
                      {canDrag
                        ? "Drag the grip to reorder"
                        : layoutLocked && editMode
                          ? "Unlock to reorder tiles"
                          : "Edit layout to rearrange tiles"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          </div>
        </>
      ) : null}

      {activeApp === "workspace" ? (
        <div className="mx-auto w-full max-w-6xl">
          <DesktopWorkspaceApp />
        </div>
      ) : null}
      {activeApp === "photos" ? (
        <div className="mx-auto w-full max-w-6xl">
          <PhotosApp />
        </div>
      ) : null}
      {activeApp === "dropbox" ? (
        <div className="mx-auto w-full max-w-6xl">
          <DropboxBrowserApp />
        </div>
      ) : null}
      {activeApp === "web" ? (
        <div className="mx-auto w-full max-w-6xl">
          <WebInterfaceApp />
        </div>
      ) : null}
    </div>
  );
}

export default App;
