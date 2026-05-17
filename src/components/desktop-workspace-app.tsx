import { MonitorCog } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { FileBrowser } from "@/components/file-browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AppDescriptor } from "@/lib/apps/types";
import { cn } from "@/lib/utils";

const DesktopTerminal = lazy(() =>
  import("@/components/desktop-terminal").then((m) => ({
    default: m.DesktopTerminal,
  })),
);

export function DesktopWorkspaceApp() {
  const [tab, setTab] = useState("files");
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);

  function handleTabChange(value: string) {
    setTab(value);
    if (value === "terminal") {
      setTerminalEverOpened(true);
    }
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col gap-4">
      <TabsList>
        <TabsTrigger value="files">File viewer</TabsTrigger>
        <TabsTrigger value="terminal">Desktop shell</TabsTrigger>
      </TabsList>
      <TabsContent value="files" className="flex flex-col gap-4">
        <FileBrowser />
      </TabsContent>
      {terminalEverOpened ? (
        <TabsContent
          value="terminal"
          forceMount
          className={cn("flex flex-col gap-4 data-[state=inactive]:hidden")}
        >
          <Suspense
            fallback={<p className="text-sm text-muted-foreground">Loading terminal…</p>}
          >
            <DesktopTerminal active={tab === "terminal"} />
          </Suspense>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

/**
 * Registry descriptor — adds this app to the dashboard. The shell
 * passes an `AppContext` we don't currently use (no deep-links into
 * the workspace yet).
 */
export const desktopWorkspaceAppDescriptor: AppDescriptor = {
  id: "workspace",
  title: "Desktop Workspace",
  dashboardCard: {
    icon: MonitorCog,
    description:
      "Open the desktop shell and browse folders inside a single app.",
    launchLabel: "Launch workspace app",
    category: "workspace",
  },
  render: () => <DesktopWorkspaceApp />,
};
