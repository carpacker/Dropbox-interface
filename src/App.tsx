import { lazy, Suspense, useState } from "react";

import { FileBrowser } from "@/components/file-browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const DesktopTerminal = lazy(() =>
  import("@/components/desktop-terminal").then((m) => ({
    default: m.DesktopTerminal,
  })),
);

function App() {
  const [tab, setTab] = useState("files");
  const [terminalEverOpened, setTerminalEverOpened] = useState(false);

  function handleTabChange(value: string) {
    setTab(value);
    if (value === "terminal") {
      setTerminalEverOpened(true);
    }
  }

  return (
    <div className="flex min-h-screen flex-col gap-6 bg-background p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Dropbox Interface
        </h1>
        <p className="text-sm text-muted-foreground">
          Desktop shell · React · TypeScript · shadcn/ui · Tauri
        </p>
      </header>

      <Tabs value={tab} onValueChange={handleTabChange} className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="flex flex-col gap-4">
          <FileBrowser />
        </TabsContent>
        {terminalEverOpened ? (
          <TabsContent
            value="terminal"
            forceMount
            className={cn(
              "flex flex-col gap-4 data-[state=inactive]:hidden",
            )}
          >
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">
                  Loading terminal…
                </p>
              }
            >
              <DesktopTerminal active={tab === "terminal"} />
            </Suspense>
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}

export default App;
