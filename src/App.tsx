import {
  ArrowLeft,
  Edit3,
  Eye,
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
import { renderInternalSubapplication } from "@/components/internal-subapplications";
import { WebInterfaceApp } from "@/components/web-interface-app";
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { setBridgePhotosSeed } from "@/lib/bridge-photos-seed";
import {
  webBridgeSetDashboardState,
  webBridgeTakeDashboardEditCommand,
  webBridgeTakeDashboardLayoutCommand,
  webBridgeTakeOpenAppCommand,
} from "@/lib/web-bridge";
import {
  DEFAULT_INTERNAL_SIZES,
  INTERNAL_APP_ORDER,
  getInternalAppDefinition,
  type InternalAppId,
} from "@/lib/internal-apps";

const DASHBOARD_LAYOUT_KEY = "dropbox-interface:dashboard-layout-v1";
const INTERNAL_DASHBOARD_LAYOUT_KEY = "dropbox-interface:internal-dashboard-layout-v1";
const DASHBOARD_EDIT_LOCK_KEY = "dropbox-interface:dashboard-edit-locked";

type ToolKey = "workspace" | "dropbox" | "web";
type ActiveSurface = "dashboard" | ToolKey | InternalAppId;
type CardSize = "compact" | "wide" | "tall";

const ALL_TOOL_KEYS: ToolKey[] = ["workspace", "dropbox", "web"];

type AppDefinition = {
  key: ToolKey;
  title: string;
  description: string;
  launchLabel: string;
  icon: ComponentType<{ className?: string }>;
};

type DashboardLayout = {
  order: ToolKey[];
  sizes: Record<ToolKey, CardSize>;
};

type InternalDashboardLayout = {
  order: InternalAppId[];
  sizes: Record<InternalAppId, CardSize>;
};

const DEFAULT_ORDER: ToolKey[] = ["workspace", "dropbox", "web"];
const DEFAULT_SIZES: Record<ToolKey, CardSize> = {
  workspace: "wide",
  dropbox: "compact",
  web: "compact",
};

const APP_DEFINITIONS: AppDefinition[] = [
  {
    key: "workspace",
    title: "Desktop Workspace",
    description: "Files browser and terminal in one desktop shell.",
    launchLabel: "Open workspace",
    icon: MonitorCog,
  },
  {
    key: "dropbox",
    title: "Dropbox Explorer",
    description: "Connect with Dropbox and browse cloud files.",
    launchLabel: "Open Dropbox",
    icon: Link2,
  },
  {
    key: "web",
    title: "Web Interface",
    description: "Configure the local HTTP bridge for remote control.",
    launchLabel: "Open web bridge",
    icon: Globe,
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
    const validOrder = deduped.filter((key): key is ToolKey =>
      ALL_TOOL_KEYS.includes(key as ToolKey),
    );
    const missing = DEFAULT_ORDER.filter((key) => !validOrder.includes(key));
    const order = [...validOrder, ...missing];
    const sizes = { ...DEFAULT_SIZES };
    if (parsed.sizes && typeof parsed.sizes === "object") {
      const rawSizes = parsed.sizes as Record<string, unknown>;
      for (const key of ALL_TOOL_KEYS) {
        const value = rawSizes[key];
        if (value === "compact" || value === "wide" || value === "tall") {
          sizes[key] = value;
        }
      }
    }
    return { order, sizes };
  } catch {
    return fallback;
  }
}

function persistLayout(layout: DashboardLayout) {
  localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
}

function restoreInternalLayout(): InternalDashboardLayout {
  const fallback: InternalDashboardLayout = {
    order: [...INTERNAL_APP_ORDER],
    sizes: { ...DEFAULT_INTERNAL_SIZES },
  };
  const raw = localStorage.getItem(INTERNAL_DASHBOARD_LAYOUT_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<InternalDashboardLayout>;
    const inputOrder = Array.isArray(parsed.order) ? parsed.order : [];
    const deduped = inputOrder.filter((key, idx) => inputOrder.indexOf(key) === idx);
    const validOrder = deduped.filter((key): key is InternalAppId =>
      INTERNAL_APP_ORDER.includes(key as InternalAppId),
    );
    const missing = INTERNAL_APP_ORDER.filter((key) => !validOrder.includes(key));
    const order = [...validOrder, ...missing];
    const sizes = { ...DEFAULT_INTERNAL_SIZES };
    if (parsed.sizes && typeof parsed.sizes === "object") {
      const rawSizes = parsed.sizes as Record<string, unknown>;
      for (const key of INTERNAL_APP_ORDER) {
        const value = rawSizes[key];
        if (value === "compact" || value === "wide" || value === "tall") {
          sizes[key] = value;
        }
      }
    }
    return { order, sizes };
  } catch {
    return fallback;
  }
}

function persistInternalLayout(layout: InternalDashboardLayout) {
  localStorage.setItem(INTERNAL_DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
}

function isActiveSurface(value: string): value is ActiveSurface {
  if (value === "dashboard") {
    return true;
  }
  if (ALL_TOOL_KEYS.includes(value as ToolKey)) {
    return true;
  }
  return INTERNAL_APP_ORDER.includes(value as InternalAppId);
}

function applyLayoutPatchToTools(
  base: DashboardLayout,
  patch: { order?: string[]; sizes?: Record<string, string> },
): DashboardLayout {
  let order = [...base.order];
  const sizes = { ...base.sizes };
  if (patch.order !== undefined && patch.order.length > 0) {
    const deduped = patch.order.filter((key, idx) => patch.order!.indexOf(key) === idx);
    const validOrder = deduped.filter((key): key is ToolKey =>
      ALL_TOOL_KEYS.includes(key as ToolKey),
    );
    const missing = DEFAULT_ORDER.filter((key) => !validOrder.includes(key));
    order = [...validOrder, ...missing];
  }
  if (patch.sizes !== undefined) {
    for (const key of ALL_TOOL_KEYS) {
      const value = patch.sizes[key];
      if (value === "compact" || value === "wide" || value === "tall") {
        sizes[key] = value;
      }
    }
  }
  return { order, sizes };
}

function applyLayoutPatchToInternal(
  base: InternalDashboardLayout,
  patch: { order?: string[]; sizes?: Record<string, string> },
): InternalDashboardLayout {
  let order = [...base.order];
  const sizes = { ...base.sizes };
  if (patch.order !== undefined && patch.order.length > 0) {
    const deduped = patch.order.filter((key, idx) => patch.order!.indexOf(key) === idx);
    const validOrder = deduped.filter((key): key is InternalAppId =>
      INTERNAL_APP_ORDER.includes(key as InternalAppId),
    );
    const missing = INTERNAL_APP_ORDER.filter((key) => !validOrder.includes(key));
    order = [...validOrder, ...missing];
  }
  if (patch.sizes !== undefined) {
    for (const key of INTERNAL_APP_ORDER) {
      const value = patch.sizes[key];
      if (value === "compact" || value === "wide" || value === "tall") {
        sizes[key] = value;
      }
    }
  }
  return { order, sizes };
}

function photosScopeForBridgeOpenApp(app: string): string | null {
  switch (app) {
    case "photos":
      return "internal_photos";
    case "shoots_field":
      return "shoots_field";
    case "shoots_studio":
      return "shoots_studio";
    default:
      return null;
  }
}

function App() {
  const [activeApp, setActiveApp] = useState<ActiveSurface>("dashboard");
  const [layout, setLayout] = useState<DashboardLayout>(() => restoreLayout());
  const [internalLayout, setInternalLayout] = useState<InternalDashboardLayout>(() =>
    restoreInternalLayout(),
  );
  const [editMode, setEditMode] = useState(false);
  const [layoutLocked, setLayoutLocked] = useState(
    () => localStorage.getItem(DASHBOARD_EDIT_LOCK_KEY) === "true",
  );
  const [draggingTool, setDraggingTool] = useState<ToolKey | null>(null);
  const [dragOverKey, setDragOverKey] = useState<ToolKey | null>(null);
  const [draggingInternal, setDraggingInternal] = useState<InternalAppId | null>(null);
  const [dragOverInternal, setDragOverInternal] = useState<InternalAppId | null>(null);

  const title = useMemo(() => {
    if (activeApp === "dashboard") {
      return "Dashboard";
    }
    if (ALL_TOOL_KEYS.includes(activeApp as ToolKey)) {
      switch (activeApp as ToolKey) {
        case "workspace":
          return "Desktop Workspace";
        case "dropbox":
          return "Dropbox Explorer";
        case "web":
          return "Web Interface";
        default:
          return "Dashboard";
      }
    }
    try {
      return getInternalAppDefinition(activeApp as InternalAppId).title;
    } catch {
      return "Dashboard";
    }
  }, [activeApp]);

  const orderedApps = useMemo(() => {
    const byKey = new Map(APP_DEFINITIONS.map((app) => [app.key, app]));
    return layout.order.map((key) => byKey.get(key)).filter(Boolean) as AppDefinition[];
  }, [layout.order]);

  const orderedInternalApps = useMemo(() => {
    return internalLayout.order.map((id) => getInternalAppDefinition(id));
  }, [internalLayout.order]);

  useEffect(() => {
    void webBridgeSetDashboardState({
      activeApp,
      editMode,
      layoutLocked,
      layout,
      internalLayout,
      orderedApps: orderedApps.map((app) => app.key),
      orderedInternalApps: internalLayout.order,
      publishedAt: Date.now(),
    }).catch(() => {});
  }, [activeApp, editMode, layoutLocked, layout, internalLayout, orderedApps]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void webBridgeTakeOpenAppCommand()
        .then((cmd) => {
          if (!cmd) return;
          const app = cmd.app;
          if (!isActiveSurface(app)) return;
          const folder =
            typeof cmd.initialFolder === "string" ? cmd.initialFolder.trim() : "";
          if (folder) {
            const scope = photosScopeForBridgeOpenApp(app);
            if (scope) {
              setBridgePhotosSeed(scope, folder);
            }
          }
          setActiveApp(app);
        })
        .catch(() => {});

      void webBridgeTakeDashboardLayoutCommand()
        .then((layoutCmd) => {
          if (!layoutCmd) return;
          const { tools, internal } = layoutCmd;
          const toolsHasOrder = tools?.order != null && tools.order.length > 0;
          const toolsHasSizes = tools?.sizes != null;
          if (tools && (toolsHasOrder || toolsHasSizes)) {
            setLayout((prev) => {
              const next = applyLayoutPatchToTools(prev, {
                order: toolsHasOrder ? tools.order : undefined,
                sizes: toolsHasSizes ? tools.sizes : undefined,
              });
              persistLayout(next);
              return next;
            });
          }
          const internalHasOrder = internal?.order != null && internal.order.length > 0;
          const internalHasSizes = internal?.sizes != null;
          if (internal && (internalHasOrder || internalHasSizes)) {
            setInternalLayout((prev) => {
              const next = applyLayoutPatchToInternal(prev, {
                order: internalHasOrder ? internal.order : undefined,
                sizes: internalHasSizes ? internal.sizes : undefined,
              });
              persistInternalLayout(next);
              return next;
            });
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

  function moveInternalCard(fromKey: InternalAppId, toKey: InternalAppId) {
    if (fromKey === toKey) return;
    const next = [...internalLayout.order];
    const fromIdx = next.indexOf(fromKey);
    const toIdx = next.indexOf(toKey);
    if (fromIdx < 0 || toIdx < 0) return;
    next.splice(fromIdx, 1);
    next.splice(toIdx, 0, fromKey);
    const updated = { ...internalLayout, order: next };
    setInternalLayout(updated);
    persistInternalLayout(updated);
  }

  function updateInternalCardSize(key: InternalAppId, size: CardSize) {
    const updated = {
      ...internalLayout,
      sizes: { ...internalLayout.sizes, [key]: size },
    };
    setInternalLayout(updated);
    persistInternalLayout(updated);
  }

  function moveCard(fromKey: ToolKey, toKey: ToolKey) {
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

  function updateCardSize(key: ToolKey, size: CardSize) {
    const updated = {
      ...layout,
      sizes: { ...layout.sizes, [key]: size },
    };
    setLayout(updated);
    persistLayout(updated);
  }

  function resetLayout() {
    const nextTools = { order: [...DEFAULT_ORDER], sizes: { ...DEFAULT_SIZES } };
    setLayout(nextTools);
    persistLayout(nextTools);
    const nextInternal = {
      order: [...INTERNAL_APP_ORDER],
      sizes: { ...DEFAULT_INTERNAL_SIZES },
    };
    setInternalLayout(nextInternal);
    persistInternalLayout(nextInternal);
  }

  function toggleLayoutLock() {
    const next = !layoutLocked;
    setLayoutLocked(next);
    localStorage.setItem(DASHBOARD_EDIT_LOCK_KEY, next ? "true" : "false");
  }

  function cardSpanClass(key: ToolKey) {
    const size = layout.sizes[key];
    if (size === "wide") return "md:col-span-2";
    if (size === "tall") return "md:row-span-2";
    return "";
  }

  function cardSpanClassInternal(key: InternalAppId) {
    const size = internalLayout.sizes[key];
    if (size === "wide") return "md:col-span-2";
    if (size === "tall") return "md:row-span-2";
    return "";
  }

  function endDragSession() {
    setDraggingTool(null);
    setDragOverKey(null);
    setDraggingInternal(null);
    setDragOverInternal(null);
  getRecentPipelines,
  setPinned,
  type RecentPipeline,
} from "@/lib/pipeline-recents";
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
              Internal workflow apps plus workspace, Dropbox, and the web bridge — one desktop shell.
            </p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-3 sm:items-end">
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
          {activeApp === "dashboard" ? (
            <div className="flex w-full flex-wrap items-center justify-end gap-2 border-t border-border/60 pt-3">
              <span className="text-xs font-medium text-muted-foreground">Internal apps</span>
              {internalLayout.order.map((id) => {
                const def = getInternalAppDefinition(id);
                return (
                  <Button
                    key={id}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 shadow-sm"
                    onClick={() => setActiveApp(id)}
                  >
                    {def.title}
                  </Button>
                );
              })}
            </div>
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
                    tiles by the grip handle on both sections.
                  </>
                ) : (
                  <>
                    <span className="font-medium text-foreground">Drag the grip</span> on{" "}
                    <span className="font-medium text-foreground">Internal applications</span> or{" "}
                    <span className="font-medium text-foreground">Tools</span> tiles to reorder. Use the size
                    picker in edit mode where available.
                  </>
                )}
              </p>
            </div>
          ) : null}
          <div className="mx-auto w-full max-w-6xl space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Internal applications</h2>
              <p className="text-xs text-muted-foreground">
                Workflow starting points. Reorder and resize tiles below in edit mode — same rules as Tools.
              </p>
            </div>
            <div className="grid w-full gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-2 xl:grid-cols-3">
              {orderedInternalApps.map((def) => {
                const id = def.id;
                const Icon = def.icon;
                const isDragging = draggingInternal === id;
                const isDropTarget = Boolean(
                  draggingInternal && dragOverInternal === id && draggingInternal !== id,
                );
                const canDrag = editMode && !layoutLocked;
                return (
                  <Card
                    key={id}
                    onDragOver={(e) => {
                      if (!draggingInternal || !canDrag) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      setDragOverInternal(id);
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDragOverInternal((prev) => (prev === id ? null : prev));
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggingInternal && canDrag) {
                        moveInternalCard(draggingInternal, id);
                      }
                      endDragSession();
                    }}
                    className={`${cardSpanClassInternal(id)} flex flex-col border-primary/15 shadow-sm ring-1 ring-primary/10 transition-[box-shadow,transform,opacity] duration-200 hover:-translate-y-0.5 hover:shadow-md hover:ring-primary/20 ${
                      isDragging ? "scale-[0.99] opacity-60 ring-2 ring-primary/50" : ""
                    } ${
                      isDropTarget ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
                    }`}
                  >
                    <CardHeader className="gap-2">
                      <CardTitle className="flex items-start justify-between gap-2 text-base">
                        <span className="flex min-w-0 items-start gap-3">
                          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon className="size-5" aria-hidden />
                          </span>
                          <span className="leading-snug">{def.title}</span>
                        </span>
                        <span
                          role="button"
                          tabIndex={canDrag ? 0 : -1}
                          draggable={canDrag}
                          aria-label={
                            canDrag
                              ? `Drag to reorder ${def.title}`
                              : "Enable edit layout and unlock to reorder"
                          }
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
                            e.dataTransfer.setData("text/plain", id);
                            setDraggingTool(null);
                            setDragOverKey(null);
                            setDraggingInternal(id);
                          }}
                          onDragEnd={endDragSession}
                        >
                          <GripVertical className="size-5" aria-hidden />
                        </span>
                      </CardTitle>
                      <CardDescription>{def.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto flex flex-col gap-3">
                      <p className="text-xs text-muted-foreground">{def.subtitle}</p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            className="shadow-sm"
                            onClick={() => setActiveApp(id)}
                          >
                            {def.openLabel}
                          </Button>
                          <span className="rounded-md border border-dashed border-muted-foreground/40 px-2 py-1 text-[0.7rem] font-medium text-muted-foreground">
                            Internal
                          </span>
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                          {editMode ? (
                            <Select
                              value={internalLayout.sizes[id]}
                              onValueChange={(value) => updateInternalCardSize(id, value as CardSize)}
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
                              ? "Drag grip to reorder"
                              : layoutLocked && editMode
                                ? "Unlock to reorder"
                                : "Edit layout to rearrange"}
                          </p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          <div className="mx-auto w-full max-w-6xl space-y-3">
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-foreground">Tools</h2>
              <p className="text-xs text-muted-foreground">
                Utilities and integrations. These tiles participate in dashboard layout edit mode.
              </p>
            </div>
            <div className="grid gap-4 md:auto-rows-[minmax(180px,auto)] md:grid-cols-2 xl:grid-cols-3">
          {orderedApps.map((app) => {
            const Icon = app.icon;
            const isDragging = draggingTool === app.key;
            const isDropTarget = Boolean(draggingTool && dragOverKey === app.key && draggingTool !== app.key);
            const canDrag = editMode && !layoutLocked;
            return (
              <Card
                key={app.key}
                onDragOver={(e) => {
                  if (!draggingTool || !canDrag) return;
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
                  if (draggingTool && canDrag) {
                    moveCard(draggingTool, app.key);
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
                        setDraggingInternal(null);
                        setDragOverInternal(null);
                        setDraggingTool(app.key);
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
                          ? "Unlock to reorder tool tiles"
                          : "Edit layout to rearrange tool tiles"}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
            </div>
          </div>
        </>
      ) : null}

      {activeApp === "workspace" ? (
        <div className="mx-auto w-full max-w-6xl">
          <DesktopWorkspaceApp />
        </div>
      ) : null}
      {INTERNAL_APP_ORDER.includes(activeApp as InternalAppId) ? (
        <div className="mx-auto w-full max-w-6xl">
          {renderInternalSubapplication(activeApp as InternalAppId)}
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

/**
 * "5m ago" / "2h ago" / "3d ago"-style relative timestamp. Pure;
 * exported for the test file.
 */
export function formatRelativeTime(ms: number, now: number): string {
  const delta = Math.max(0, now - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

export default App;
