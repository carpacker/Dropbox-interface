import {
  AlertCircle,
  ChevronUp,
  Download,
  File,
  Folder,
  ImageIcon,
  LogOut,
  Plug,
  RefreshCw,
  X,
} from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
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
  dropboxDownloadToTemp,
  dropboxGetThumbnail,
  dropboxIsConfigured,
  dropboxListFolder,
  dropboxLocalSrc,
  dropboxParent,
  dropboxSaveFileTo,
  dropboxStatus,
  isDropboxImage,
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

type Preview =
  | { kind: "loading"; entry: DropboxEntry }
  | { kind: "ready"; entry: DropboxEntry; localPath: string }
  | { kind: "error"; entry: DropboxEntry; message: string };

function RemoteBrowser({ account, onDisconnect }: RemoteBrowserProps) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

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

  useEffect(() => {
    if (!preview) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPreview(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  function handleGoUp() {
    const parent = dropboxParent(path);
    if (parent !== null) {
      void load(parent);
    }
  }

  async function openPreview(entry: DropboxEntry) {
    setPreview({ kind: "loading", entry });
    try {
      const localPath = await dropboxDownloadToTemp(entry.path);
      setPreview({ kind: "ready", entry, localPath });
    } catch (e) {
      setPreview({
        kind: "error",
        entry,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  async function handleSave(entry: DropboxEntry) {
    setSavedNotice(null);
    let dest: string | null;
    try {
      dest = await save({ defaultPath: entry.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!dest) return;
    setSavingPath(entry.path);
    try {
      await dropboxSaveFileTo(entry.path, dest);
      setSavedNotice(`Saved “${entry.name}” to ${dest}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPath(null);
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

        {savedNotice ? (
          <p
            role="status"
            className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400"
          >
            {savedNotice}
          </p>
        ) : null}

        <Separator />

        <ScrollArea className="h-[min(55vh,520px)] rounded-lg border">
          <ul className="flex flex-col gap-1 p-2">
            {loading ? (
              <li className="px-2 py-6 text-sm text-muted-foreground">Loading…</li>
            ) : entries.length === 0 ? (
              <li className="px-2 py-6 text-sm text-muted-foreground">
                This folder is empty.
              </li>
            ) : (
              entries.map((entry) => (
                <li key={entry.path}>
                  <EntryRow
                    entry={entry}
                    saving={savingPath === entry.path}
                    onOpenFolder={(p) => void load(p)}
                    onPreview={() => void openPreview(entry)}
                    onSave={() => void handleSave(entry)}
                  />
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </CardContent>

      {preview ? (
        <PreviewLightbox
          preview={preview}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </Card>
  );
}

type EntryRowProps = {
  entry: DropboxEntry;
  saving: boolean;
  onOpenFolder: (path: string) => void;
  onPreview: () => void;
  onSave: () => void;
};

function EntryRow({
  entry,
  saving,
  onOpenFolder,
  onPreview,
  onSave,
}: EntryRowProps) {
  const isImage = isDropboxImage(entry);
  const isFolder = entry.kind === "folder";

  function handleMainClick() {
    if (isFolder) {
      onOpenFolder(entry.path);
    } else if (isImage) {
      onPreview();
    }
  }

  const mainDisabled = !isFolder && !isImage;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        className="h-auto min-w-0 flex-1 justify-start gap-2 px-2 py-1.5 font-normal"
        disabled={mainDisabled}
        onClick={handleMainClick}
        aria-label={
          isFolder
            ? `Open folder ${entry.name}`
            : isImage
              ? `Preview ${entry.name}`
              : entry.name
        }
      >
        <EntryIcon entry={entry} isImage={isImage} />
        <span className="truncate">{entry.name}</span>
      </Button>
      {!isFolder ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={saving}
          onClick={onSave}
          aria-label={`Save ${entry.name} to disk`}
        >
          <Download data-icon="inline-start" />
        </Button>
      ) : null}
    </div>
  );
}

function EntryIcon({ entry, isImage }: { entry: DropboxEntry; isImage: boolean }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let cancelled = false;
    void (async () => {
      try {
        const url = await dropboxGetThumbnail(entry.path, "w64h64");
        if (!cancelled) setThumb(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry.path, isImage]);

  if (entry.kind === "folder") {
    return <Folder data-icon="inline-start" />;
  }
  if (!isImage || failed) {
    return <File data-icon="inline-start" />;
  }
  if (!thumb) {
    return <ImageIcon data-icon="inline-start" />;
  }
  return (
    <img
      src={thumb}
      alt=""
      aria-hidden="true"
      data-testid={`thumbnail-${entry.path}`}
      className="h-5 w-5 shrink-0 rounded-sm object-cover"
    />
  );
}

function PreviewLightbox({
  preview,
  onClose,
}: {
  preview: Preview;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview ${preview.entry.name}`}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
    >
      <div
        className="relative flex max-h-full max-w-full flex-col items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onClose}
          className="absolute right-2 top-2 z-10"
          aria-label="Close preview"
        >
          <X data-icon="inline-start" />
        </Button>
        {preview.kind === "loading" ? (
          <p className="rounded-lg border bg-card px-6 py-4 text-sm text-muted-foreground">
            Downloading {preview.entry.name}…
          </p>
        ) : preview.kind === "error" ? (
          <p
            role="alert"
            className="max-w-md rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {preview.message}
          </p>
        ) : (
          <img
            src={dropboxLocalSrc(preview.localPath)}
            alt={preview.entry.name}
            className="max-h-[85vh] max-w-[90vw] rounded-lg object-contain shadow-2xl"
          />
        )}
      </div>
    </div>
  );
}
