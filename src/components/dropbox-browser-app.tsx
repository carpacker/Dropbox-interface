import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronUp,
  File,
  Folder,
  KeyRound,
  Link2,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  buildDropboxAuthorizeUrl,
  exchangeDropboxCode,
  getDropboxLatestCursor,
  getDropboxTemporaryLink,
  listDropboxFolder,
  listDropboxFolderContinue,
  refreshDropboxToken,
  type DropboxEntry,
  type DropboxTokenResponse,
} from "@/lib/dropbox";

const TOKEN_STORAGE_KEY = "dropbox-interface:dropbox-token";
const TOKEN_BUNDLE_KEY = "dropbox-interface:dropbox-token-bundle";
const APP_KEY_STORAGE_KEY = "dropbox-interface:dropbox-app-key";
const REDIRECT_URI_STORAGE_KEY = "dropbox-interface:dropbox-redirect-uri";
const OAUTH_STATE_STORAGE_KEY = "dropbox-interface:dropbox-oauth-state";
const SYNC_CHECKPOINTS_KEY = "dropbox-interface:dropbox-sync-checkpoints";
const SLIDESHOW_MS = 2500;

type TokenBundle = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
};

type SyncSummary = {
  checkedAt: number;
  totalChanges: number;
  fileChanges: number;
  folderChanges: number;
  deletedChanges: number;
};

type SyncChangeItem = {
  tag: DropboxEntry[".tag"];
  name: string;
  path: string;
};

function randomString(bytes = 32) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(arr)
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

function toBase64Url(bytes: Uint8Array) {
  const asString = String.fromCharCode(...bytes);
  const b64 = btoa(asString);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function pkceChallenge(verifier: string) {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return toBase64Url(new Uint8Array(digest));
}

function parentPath(path: string): string | null {
  if (!path) {
    return null;
  }
  const normalized = path.replace(/\/+$/, "");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return "";
  }
  return normalized.slice(0, idx);
}

function parseAuthInput(raw: string) {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    return { code, state };
  } catch {
    return { code: trimmed, state: "" };
  }
}

export function DropboxBrowserApp() {
  const [tokenInput, setTokenInput] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "");
  const [connectedToken, setConnectedToken] = useState(() => {
    const bundleRaw = localStorage.getItem(TOKEN_BUNDLE_KEY);
    if (bundleRaw) {
      try {
        const parsed = JSON.parse(bundleRaw) as TokenBundle;
        return parsed.accessToken;
      } catch {
        /* ignore invalid */
      }
    }
    return localStorage.getItem(TOKEN_STORAGE_KEY) ?? "";
  });
  const [tokenBundle, setTokenBundle] = useState<TokenBundle | null>(() => {
    const bundleRaw = localStorage.getItem(TOKEN_BUNDLE_KEY);
    if (!bundleRaw) {
      return null;
    }
    try {
      return JSON.parse(bundleRaw) as TokenBundle;
    } catch {
      return null;
    }
  });
  const [appKey, setAppKey] = useState(() => localStorage.getItem(APP_KEY_STORAGE_KEY) ?? "");
  const [redirectUri, setRedirectUri] = useState(
    () => localStorage.getItem(REDIRECT_URI_STORAGE_KEY) ?? "http://localhost:53682/dropbox/auth",
  );
  const [oauthCodeInput, setOauthCodeInput] = useState("");
  const [oauthVerifier, setOauthVerifier] = useState("");
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<DropboxEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<DropboxEntry | null>(null);
  const [selectedLink, setSelectedLink] = useState<string | null>(null);
  const [isSlideshowPlaying, setIsSlideshowPlaying] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncChanges, setSyncChanges] = useState<SyncChangeItem[]>([]);
  const [syncCheckpoints, setSyncCheckpoints] = useState<Record<string, string>>(() => {
    const raw = localStorage.getItem(SYNC_CHECKPOINTS_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  });

  const canConnect = tokenInput.trim().length > 0;

  function saveBundle(bundle: TokenBundle) {
    setTokenBundle(bundle);
    setConnectedToken(bundle.accessToken);
    setTokenInput(bundle.accessToken);
    localStorage.setItem(TOKEN_STORAGE_KEY, bundle.accessToken);
    localStorage.setItem(TOKEN_BUNDLE_KEY, JSON.stringify(bundle));
  }

  async function ensureFreshAccessToken() {
    if (!tokenBundle?.refreshToken || !tokenBundle.expiresAt || !appKey.trim()) {
      return connectedToken;
    }
    const skewedNow = Date.now() + 30_000;
    if (skewedNow < tokenBundle.expiresAt) {
      return tokenBundle.accessToken;
    }
    const refreshed = await refreshDropboxToken({
      clientId: appKey.trim(),
      refreshToken: tokenBundle.refreshToken,
    });
    const bundle: TokenBundle = {
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? tokenBundle.refreshToken,
      expiresAt: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : tokenBundle.expiresAt,
    };
    saveBundle(bundle);
    return bundle.accessToken;
  }

  const loadPath = useCallback(
    async (nextPath: string, tokenOverride?: string) => {
      const effectiveToken = tokenOverride || connectedToken;
      if (!effectiveToken) {
        return;
      }
      setLoading(true);
      setError(null);
      setSelectedFile(null);
      setSelectedLink(null);
      try {
        const token = tokenOverride ?? (await ensureFreshAccessToken());
        const data = await listDropboxFolder(token, nextPath);
        const sorted = data.entries.sort((a, b) => {
          if (a[".tag"] === "folder" && b[".tag"] !== "folder") return -1;
          if (a[".tag"] !== "folder" && b[".tag"] === "folder") return 1;
          return a.name.localeCompare(b.name);
        });
        setEntries(sorted);
        setCursor(data.cursor);
        setHasMore(data.has_more);
        setPath(nextPath);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [connectedToken, tokenBundle, appKey],
  );

  const loadMore = useCallback(async () => {
    if (!connectedToken || !cursor || !hasMore) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = await ensureFreshAccessToken();
      const data = await listDropboxFolderContinue(token, cursor);
      const merged = [...entries, ...data.entries];
      const sorted = merged.sort((a, b) => {
        if (a[".tag"] === "folder" && b[".tag"] !== "folder") return -1;
        if (a[".tag"] !== "folder" && b[".tag"] === "folder") return 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setCursor(data.cursor);
      setHasMore(data.has_more);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [connectedToken, cursor, entries, hasMore, tokenBundle, appKey]);

  const folderEntries = useMemo(
    () => entries.filter((entry) => entry[".tag"] === "folder"),
    [entries],
  );
  const fileEntries = useMemo(
    () => entries.filter((entry) => entry[".tag"] === "file"),
    [entries],
  );
  const imageEntries = useMemo(
    () =>
      fileEntries.filter((entry) =>
        /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico|tif|tiff)$/i.test(
          entry.path_display ?? entry.path_lower ?? "",
        ),
      ),
    [fileEntries],
  );
  const selectedPath = selectedFile?.path_display ?? selectedFile?.path_lower ?? "";
  const isImageSelected = Boolean(
    selectedFile && /\.(jpg|jpeg|png|gif|webp|bmp|svg|avif|ico|tif|tiff)$/i.test(selectedPath),
  );
  const selectedImageIndex = useMemo(
    () => imageEntries.findIndex((entry) => entry.id === selectedFile?.id),
    [imageEntries, selectedFile],
  );
  const checkpointKey = path || "/";
  const checkpointCursor = syncCheckpoints[checkpointKey] ?? null;

  async function connect() {
    const token = tokenInput.trim();
    if (!token) return;
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setConnectedToken(token);
    setPath("");
    setEntries([]);
    await loadPath("", token);
  }

  async function startOauth() {
    if (!appKey.trim() || !redirectUri.trim()) {
      setError("Set Dropbox app key and redirect URI first.");
      return;
    }
    setAuthBusy(true);
    setError(null);
    try {
      localStorage.setItem(APP_KEY_STORAGE_KEY, appKey.trim());
      localStorage.setItem(REDIRECT_URI_STORAGE_KEY, redirectUri.trim());
      const verifier = randomString(48);
      const challenge = await pkceChallenge(verifier);
      const state = randomString(16);
      setOauthVerifier(verifier);
      localStorage.setItem(OAUTH_STATE_STORAGE_KEY, state);
      const url = buildDropboxAuthorizeUrl({
        clientId: appKey.trim(),
        redirectUri: redirectUri.trim(),
        codeChallenge: challenge,
        state,
      });
      await openUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }

  async function exchangeCode() {
    if (!appKey.trim() || !redirectUri.trim() || !oauthCodeInput.trim() || !oauthVerifier) {
      setError("Missing app key, redirect URI, verifier, or code.");
      return;
    }
    setAuthBusy(true);
    setError(null);
    try {
      const parsed = parseAuthInput(oauthCodeInput);
      const storedState = localStorage.getItem(OAUTH_STATE_STORAGE_KEY);
      if (parsed.state && storedState && parsed.state !== storedState) {
        throw new Error("OAuth state mismatch. Start OAuth again.");
      }
      const code = parsed.code;
      const payload: DropboxTokenResponse = await exchangeDropboxCode({
        clientId: appKey.trim(),
        code,
        codeVerifier: oauthVerifier,
        redirectUri: redirectUri.trim(),
      });
      const bundle: TokenBundle = {
        accessToken: payload.access_token,
        refreshToken: payload.refresh_token,
        expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : undefined,
      };
      saveBundle(bundle);
      setOauthCodeInput("");
      localStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
      await loadPath("", bundle.accessToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  }

  function disconnect() {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    localStorage.removeItem(TOKEN_BUNDLE_KEY);
    localStorage.removeItem(OAUTH_STATE_STORAGE_KEY);
    setConnectedToken("");
    setTokenBundle(null);
    setEntries([]);
    setCursor(null);
    setHasMore(false);
    setPath("");
    setSelectedFile(null);
    setSelectedLink(null);
    setIsSlideshowPlaying(false);
    setSyncSummary(null);
    setSyncChanges([]);
    setError(null);
  }

  async function selectFile(entry: DropboxEntry) {
    if (!connectedToken) return;
    setFileBusy(true);
    setError(null);
    try {
      const token = await ensureFreshAccessToken();
      const res = await getDropboxTemporaryLink(
        token,
        entry.path_display ?? entry.path_lower ?? "",
      );
      setSelectedFile(entry);
      setSelectedLink(res.link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setFileBusy(false);
    }
  }

  async function openSelectedFile() {
    if (!selectedLink) {
      return;
    }
    await openUrl(selectedLink);
  }

  function saveCheckpointCursor(nextCursor: string) {
    const next = { ...syncCheckpoints, [checkpointKey]: nextCursor };
    setSyncCheckpoints(next);
    localStorage.setItem(SYNC_CHECKPOINTS_KEY, JSON.stringify(next));
  }

  async function setCheckpointNow() {
    if (!connectedToken) return;
    setSyncBusy(true);
    setError(null);
    try {
      const token = await ensureFreshAccessToken();
      const latest = await getDropboxLatestCursor(token, path);
      saveCheckpointCursor(latest.cursor);
      setSyncSummary(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  }

  async function syncFromCheckpoint() {
    if (!connectedToken || !checkpointCursor) {
      return;
    }
    setSyncBusy(true);
    setError(null);
    try {
      const token = await ensureFreshAccessToken();
      let pendingCursor = checkpointCursor;
      let aggregate: DropboxEntry[] = [];
      let hasMoreChanges = true;
      while (hasMoreChanges) {
        const batch = await listDropboxFolderContinue(token, pendingCursor);
        aggregate = aggregate.concat(batch.entries);
        pendingCursor = batch.cursor;
        hasMoreChanges = batch.has_more;
      }

      setSyncSummary({
        checkedAt: Date.now(),
        totalChanges: aggregate.length,
        fileChanges: aggregate.filter((entry) => entry[".tag"] === "file").length,
        folderChanges: aggregate.filter((entry) => entry[".tag"] === "folder").length,
        deletedChanges: aggregate.filter((entry) => entry[".tag"] === "deleted").length,
      });
      setSyncChanges(
        aggregate.slice(0, 120).map((entry) => ({
          tag: entry[".tag"],
          name: entry.name,
          path: entry.path_display ?? entry.path_lower ?? entry.name,
        })),
      );
      saveCheckpointCursor(pendingCursor);
      await loadPath(path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncBusy(false);
    }
  }

  function toggleSlideshow() {
    if (imageEntries.length === 0) return;
    if (selectedImageIndex < 0) {
      void selectFile(imageEntries[0]);
    }
    setIsSlideshowPlaying((prev) => !prev);
  }

  useEffect(() => {
    if (!isSlideshowPlaying || imageEntries.length === 0) return;
    const timer = window.setInterval(() => {
      const current = selectedImageIndex >= 0 ? selectedImageIndex : 0;
      const next = (current + 1) % imageEntries.length;
      void selectFile(imageEntries[next]);
    }, SLIDESHOW_MS);
    return () => window.clearInterval(timer);
  }, [imageEntries, isSlideshowPlaying, selectedImageIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (event.key === " ") {
        event.preventDefault();
        toggleSlideshow();
        return;
      }
      if (event.key === "Escape") {
        if (isSlideshowPlaying) {
          event.preventDefault();
          setIsSlideshowPlaying(false);
        }
        return;
      }
      if (imageEntries.length === 0 || isSlideshowPlaying) return;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = Math.min(imageEntries.length - 1, Math.max(0, selectedImageIndex + 1));
        void selectFile(imageEntries[next]);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = Math.max(0, selectedImageIndex > 0 ? selectedImageIndex - 1 : 0);
        void selectFile(imageEntries[next]);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [imageEntries, isSlideshowPlaying, selectedImageIndex]);

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-2 pb-4">
        <CardTitle className="flex items-center gap-2">
          <Link2 />
          Dropbox Explorer
        </CardTitle>
        <CardDescription>
          Connect with Dropbox OAuth (PKCE), then browse cloud folders and files.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="flex flex-col gap-2">
          <Input
            value={appKey}
            onChange={(event) => setAppKey(event.currentTarget.value)}
            placeholder="Dropbox app key"
            aria-label="Dropbox app key"
          />
          <Input
            value={redirectUri}
            onChange={(event) => setRedirectUri(event.currentTarget.value)}
            placeholder="OAuth redirect URI"
            aria-label="Dropbox redirect URI"
            className="font-mono text-xs sm:text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startOauth()} disabled={authBusy}>
              <KeyRound data-icon="inline-start" />
              Start OAuth
            </Button>
          </div>
          <Input
            value={oauthCodeInput}
            onChange={(event) => setOauthCodeInput(event.currentTarget.value)}
            placeholder="Paste authorization code or full redirect URL"
            aria-label="Dropbox authorization code"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void exchangeCode()} disabled={authBusy}>
              Exchange code
            </Button>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            OAuth requires your app redirect URI to be registered in Dropbox app settings.
          </p>
          <Input
            value={tokenInput}
            onChange={(event) => setTokenInput(event.currentTarget.value)}
            type="password"
            placeholder="Manual access token (fallback)"
            aria-label="Dropbox token"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void connect()} disabled={!canConnect}>
              Connect token
            </Button>
            <Button type="button" variant="outline" onClick={disconnect}>
              Disconnect
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={loading || !connectedToken}
              onClick={() => void loadPath(path)}
              aria-label="Refresh Dropbox folder"
            >
              <RefreshCw data-icon="inline-start" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={loading || !connectedToken}
              onClick={() => {
                const up = parentPath(path);
                if (up !== null) {
                  void loadPath(up);
                }
              }}
              aria-label="Parent Dropbox folder"
            >
              <ChevronUp data-icon="inline-start" />
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Current path: <span className="font-mono">{path || "/"}</span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void setCheckpointNow()}
            disabled={syncBusy || !connectedToken}
          >
            Set sync checkpoint
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void syncFromCheckpoint()}
            disabled={syncBusy || !checkpointCursor || !connectedToken}
          >
            Sync changes
          </Button>
          <p className="text-xs text-muted-foreground self-center">
            {checkpointCursor ? "Checkpoint ready" : "No checkpoint for this path"}
          </p>
        </div>
        {syncSummary ? (
          <div className="rounded-lg border p-2">
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(syncSummary.checkedAt).toLocaleTimeString()} ·{" "}
              {syncSummary.totalChanges} changes ({syncSummary.fileChanges} files,{" "}
              {syncSummary.folderChanges} folders, {syncSummary.deletedChanges} deleted)
            </p>
            {syncChanges.length > 0 ? (
              <ScrollArea className="mt-2 h-28 rounded border">
                <div className="flex flex-col gap-1 p-2">
                  {syncChanges.map((item, idx) => (
                    <p
                      key={`${item.path}-${idx}`}
                      className="truncate text-xs text-muted-foreground"
                    >
                      [{item.tag}] {item.path}
                    </p>
                  ))}
                </div>
              </ScrollArea>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No changes since checkpoint.</p>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <Separator />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,420px),minmax(0,1fr)]">
          <ScrollArea className="h-[min(60vh,560px)] rounded-lg border">
            <div className="flex flex-col gap-1 p-2">
              {!connectedToken ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">
                  Add a token and click Connect to load Dropbox contents.
                </p>
              ) : loading && entries.length === 0 ? (
                <p className="px-2 py-6 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <>
                  {folderEntries.map((entry) => (
                    <Button
                      key={entry.id}
                      type="button"
                      variant="ghost"
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      onClick={() => void loadPath(entry.path_display ?? "")}
                    >
                      <Folder data-icon="inline-start" />
                      <span className="truncate">{entry.name}</span>
                    </Button>
                  ))}
                  {fileEntries.map((entry) => (
                    <Button
                      key={entry.id}
                      type="button"
                      variant={selectedFile?.id === entry.id ? "secondary" : "ghost"}
                      className="h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal"
                      onClick={() => void selectFile(entry)}
                    >
                      <File data-icon="inline-start" />
                      <span className="truncate">{entry.name}</span>
                    </Button>
                  ))}
                  {entries.length === 0 ? (
                    <p className="px-2 py-6 text-sm text-muted-foreground">
                      This Dropbox folder is empty.
                    </p>
                  ) : null}
                  {hasMore ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-2"
                      onClick={() => void loadMore()}
                      disabled={loading}
                    >
                      Load more
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          </ScrollArea>

          <div className="rounded-lg border p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                {selectedFile ? selectedFile.name : "Select a Dropbox file"}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={toggleSlideshow}
                  disabled={imageEntries.length === 0}
                >
                  {isSlideshowPlaying ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                  {isSlideshowPlaying ? "Pause" : "Slideshow"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void openSelectedFile()}
                  disabled={!selectedLink || fileBusy}
                >
                  Open file
                </Button>
              </div>
            </div>
            <p className="mb-3 text-xs text-muted-foreground font-mono break-all">
              {selectedPath || "No file selected"}
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              Keyboard: Arrow keys navigate images, Space play/pause slideshow, Esc stop.
            </p>
            <div className="flex min-h-[min(48vh,460px)] items-center justify-center rounded-lg border bg-muted/20 p-3">
              {fileBusy ? (
                <p className="text-sm text-muted-foreground">Preparing file link…</p>
              ) : selectedLink && isImageSelected ? (
                <img
                  src={selectedLink}
                  alt={selectedFile?.name ?? "Dropbox image"}
                  className="max-h-[68vh] w-auto max-w-full rounded-md object-contain"
                />
              ) : selectedLink ? (
                <p className="text-sm text-muted-foreground">
                  Selected file is ready. Use Open file to launch it.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a file to preview image content or open via temporary link.
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
