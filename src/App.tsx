import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FileBrowser } from "@/components/file-browser";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function TerminalPlaceholder() {
  return (
    <Card>
      <CardHeader className="flex flex-col gap-2">
        <CardTitle>Terminal</CardTitle>
        <CardDescription>
          Placeholder for an embedded shell (for example xterm.js wired to a
          PTY in Tauri). The hosted web client will use SSH or a secured relay
          instead of exposing your desktop directly.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex min-h-[min(40vh,320px)] items-center justify-center rounded-lg border border-dashed bg-muted/40 px-4 py-8">
          <p className="max-w-md text-center text-sm text-muted-foreground">
            Terminal integration is not wired yet — next step is streaming a
            local PTY through Tauri commands or a plugin.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function App() {
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

      <Tabs defaultValue="files" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="terminal">Terminal</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="flex flex-col gap-4">
          <FileBrowser />
        </TabsContent>
        <TabsContent value="terminal" className="flex flex-col gap-4">
          <TerminalPlaceholder />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default App;
