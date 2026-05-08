import {
  AlertCircle,
  ChevronUp,
  File,
  Folder,
  LogOut,
  Plug,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  dropboxConnect,
  dropboxDisconnect,
  dropboxIsConfigured,
  dropboxListFolder,
  dropboxParent,
  dropboxStatus,
  type DropboxAccount,
  type DropboxEntry,
} from "@/lib/tauri-dropbox";

type Status =
  | { kind: "loading" }
  | { kind: "not-configured" }
  | { kind: "disconnected" }
  | { kind: "connected"; account: DropboxAccount }
  | { kind: "error"; message: string };

export function DropboxApp() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [connecting, setConnecting] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!dropboxIsConfigured()) {
      setStatus({ kind: "not-configured" });
      return;
    }
    try {
      const account = await dropboxStatus();
      setStatus(
        account ? { kind: "connected", account } : { kind: "disconnected" },
      );
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const account = await dropboxConnect();
      setStatus({ kind: "connected", account });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await dropboxDisconnect();
      setStatus({ kind: "disconnected" });
    } catch (e) {
      setStatus({
        kind: "error",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (status.kind === "loading") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dropbox</CardTitle>
          <CardDescription>Checking connection…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status.kind === "not-configured") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle className="flex items-center gap-2">
            <AlertCircle data-icon="inline-start" />
            Dropbox app key missing
          </CardTitle>
          <CardDescription>
            Register an app at{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              dropbox.com/developers/apps
            </code>{" "}
            (Scoped access · App folder), then add the App key to{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              .env.local
            </code>{" "}
            as{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              VITE_DROPBOX_APP_KEY=…
            </code>{" "}
            and restart the app.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (status.kind === "error") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Dropbox</CardTitle>
          <CardDescription>Something went wrong.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {status.message}
          </p>
          <div>
            <Button type="button" variant="outline" onClick={() => void refreshStatus()}>
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status.kind === "disconnected") {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle>Dropbox</CardTitle>
          <CardDescription>
            Connect your Dropbox account to browse your remote folders alongside
            local ones. Read-only access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button type="button" disabled={connecting} onClick={() => void handleConnect()}>
            <Plug data-icon="inline-start" />
            {connecting ? "Connecting…" : "Connect Dropbox"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <RemoteBrowser
      account={status.account}
      onDisconnect={() => void handleDisconnect()}
    />
  );
}

type RemoteBrowserProps = {
  account: DropboxAccount;
  onDisconnect: () => void;
};

function RemoteBrowser({ account, onDisconnect }: RemoteBrowserProps) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: string) => {
    setLoading(true);
    setError(null);
    try {
      const rows = await dropboxListFolder(next);
      setEntries(rows);
      setPath(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load("");
  }, [load]);

  function handleGoUp() {
    const parent = dropboxParent(path);
    if (parent !== null) {
      void load(parent);
    }
  }

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle>Dropbox · {account.displayName}</CardTitle>
          <CardDescription className="truncate">{account.email}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onDisconnect}>
          <LogOut data-icon="inline-start" />
          Disconnect
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex items-center gap-2">
          <code
            className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-xs"
            aria-label="Current Dropbox path"
          >
            {path === "" ? "/ (root)" : path}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={loading || dropboxParent(path) === null}
            onClick={handleGoUp}
            aria-label="Parent folder"
          >
            <ChevronUp data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={loading}
            onClick={() => void load(path)}
            aria-label="Refresh listing"
          >
            <RefreshCw data-icon="inline-start" />
          </Button>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <Separator />

        <ScrollArea className="h-[min(55vh,520px)] rounded-lg border">
          <div className="flex flex-col gap-1 p-2">
            {loading ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>
            ) : entries.length === 0 ? (
              <p className="px-2 py-6 text-sm text-muted-foreground">
                This folder is empty.
              </p>
            ) : (
              entries.map((entry) => (
                <Button
                  key={entry.path}
                  type="button"
                  variant="ghost"
                  className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                  disabled={entry.kind !== "folder"}
                  onClick={() => {
                    if (entry.kind === "folder") {
                      void load(entry.path);
                    }
                  }}
                >
                  {entry.kind === "folder" ? (
                    <Folder data-icon="inline-start" />
                  ) : (
                    <File data-icon="inline-start" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </Button>
              ))
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
