import { lazy, Suspense, useState } from "react";

import { FileBrowser } from "@/components/file-browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DesktopTerminal = lazy(() =>
  import("@/components/desktop-terminal").then((m) => ({
    default: m.DesktopTerminal,
  })),
);

function App() {
  const [tab, setTab] = useState("files");

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

      <Tabs
        value={tab}
        onValueChange={setTab}
        className="flex flex-col gap-4"
      >
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="flex flex-col gap-4">
          <FileBrowser />
        </TabsContent>
        <TabsContent value="terminal" className="flex flex-col gap-4">
          {tab === "terminal" ? (
            <Suspense
              fallback={
                <p className="text-sm text-muted-foreground">Loading terminal…</p>
              }
            >
              <DesktopTerminal />
            </Suspense>
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
