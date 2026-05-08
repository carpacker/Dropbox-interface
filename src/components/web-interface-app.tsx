import { openUrl } from "@tauri-apps/plugin-opener";
import { Globe, Info, Link2, PlugZap, Power, Square, TestTube2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  bridgeHttpGet,
  bridgeHttpPostJson,
  prettifyJsonText,
  webBridgeStart,
  webBridgeStatus,
  webBridgeStop,
  type DashboardLayoutCommand,
  type WebBridgeStatus,
} from "@/lib/web-bridge";

const WEB_BRIDGE_CONFIG_KEY = "dropbox-interface:web-bridge-config";

type WebBridgeConfig = {
  baseUrl: string;
  apiKey: string;
  allowOrigin: string;
  /** Default path for open-app when the demo button does not pass an override. */
  defaultOpenFolder?: string;
};

function restoreConfig(): WebBridgeConfig {
  const fallback: WebBridgeConfig = {
    baseUrl: "http://127.0.0.1:8787",
    apiKey: "",
    allowOrigin: "http://localhost:3000",
  };
  const raw = localStorage.getItem(WEB_BRIDGE_CONFIG_KEY);
  if (!raw) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(raw) as Partial<WebBridgeConfig>) };
  } catch {
    return fallback;
  }
}

export function WebInterfaceApp() {
  const [config, setConfig] = useState<WebBridgeConfig>(() => restoreConfig());
  const [statusText, setStatusText] = useState<string>("");
  const [bridgeStatus, setBridgeStatus] = useState<WebBridgeStatus | null>(null);
  const [dashboardStatePreview, setDashboardStatePreview] = useState<string>("");
  const [bridgeInfoPreview, setBridgeInfoPreview] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const websocketUrl = useMemo(() => {
    try {
      const url = new URL(config.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = "/ws";
      return url.toString();
    } catch {
      return "";
    }
  }, [config.baseUrl]);

  function saveConfig(next: WebBridgeConfig) {
    setConfig(next);
    localStorage.setItem(WEB_BRIDGE_CONFIG_KEY, JSON.stringify(next));
  }

  async function testHttp() {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    setStatusText("");
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      const res = await bridgeHttpGet(config.baseUrl, "/health", config.apiKey || undefined, {
        signal: controller.signal,
      });
      window.clearTimeout(timer);
      setStatusText(`Health check: ${res.status} ${res.statusText}`);
    } catch (e) {
      setStatusText(`HTTP check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchDashboardState() {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    try {
      const res = await bridgeHttpGet(config.baseUrl, "/api/dashboard/state", config.apiKey || undefined);
      const text = await res.text();
      setDashboardStatePreview(prettifyJsonText(text));
      setStatusText(`Dashboard state endpoint: ${res.status} ${res.statusText}`);
    } catch (e) {
      setStatusText(`Dashboard state fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function fetchBridgeInfo() {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    try {
      const res = await bridgeHttpGet(config.baseUrl, "/api/bridge/info", config.apiKey || undefined);
      const text = await res.text();
      setBridgeInfoPreview(prettifyJsonText(text));
      setStatusText(`Bridge info: ${res.status} ${res.statusText}`);
    } catch (e) {
      setStatusText(`Bridge info fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function postOpenAppCommand(
    app:
      | "dashboard"
      | "workspace"
      | "dropbox"
      | "web"
      | "photos"
      | "social_media"
      | "shoots_field"
      | "shoots_studio"
      | "assets",
    options?: { initialFolder?: string },
  ) {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { app };
      const folder = (options?.initialFolder ?? config.defaultOpenFolder ?? "").trim();
      if (folder) {
        body.initialFolder = folder;
      }
      const res = await bridgeHttpPostJson(
        config.baseUrl,
        "/api/commands/open-app",
        body,
        config.apiKey || undefined,
      );
      const payload = await res.text();
      setStatusText(`Open app command (${app}): ${res.status} ${payload}`);
    } catch (e) {
      setStatusText(`Open app command failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function postDashboardLayoutCommand(command: DashboardLayoutCommand) {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    try {
      const res = await bridgeHttpPostJson(
        config.baseUrl,
        "/api/commands/dashboard-layout",
        command,
        config.apiKey || undefined,
      );
      const payload = await res.text();
      setStatusText(`Dashboard layout command: ${res.status} ${payload}`);
    } catch (e) {
      setStatusText(`Dashboard layout command failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function postDashboardEditCommand(command: { editMode?: boolean; layoutLocked?: boolean }) {
    if (!config.baseUrl.trim()) return;
    setBusy(true);
    try {
      const res = await bridgeHttpPostJson(
        config.baseUrl,
        "/api/commands/dashboard-edit",
        command,
        config.apiKey || undefined,
      );
      const payload = await res.text();
      setStatusText(`Dashboard edit command: ${res.status} ${payload}`);
    } catch (e) {
      setStatusText(`Dashboard edit command failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function refreshBridgeStatus() {
    setBusy(true);
    try {
      const status = await webBridgeStatus();
      setBridgeStatus(status);
      setStatusText(status.running ? "Bridge is running." : "Bridge is stopped.");
    } catch (e) {
      setStatusText(`Bridge status failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function startBridge() {
    setBusy(true);
    setStatusText("");
    try {
      const url = new URL(config.baseUrl);
      const bindAddr = `${url.hostname}:${url.port || (url.protocol === "https:" ? "443" : "80")}`;
      const status = await webBridgeStart({
        bindAddr,
        allowOrigin: config.allowOrigin,
        apiKey: config.apiKey,
      });
      setBridgeStatus(status);
      setStatusText(`Bridge started on ${bindAddr}`);
    } catch (e) {
      setStatusText(`Start failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function stopBridge() {
    setBusy(true);
    try {
      const status = await webBridgeStop();
      setBridgeStatus(status);
      setStatusText("Bridge stopped.");
    } catch (e) {
      setStatusText(`Stop failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),minmax(0,380px)]">
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle className="flex items-center gap-2">
            <PlugZap />
            Web App Interface
          </CardTitle>
          <CardDescription>
            Configure how web clients connect to this desktop app context.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input
            value={config.baseUrl}
            onChange={(event) =>
              saveConfig({ ...config, baseUrl: event.currentTarget.value })
            }
            placeholder="Bridge base URL"
            aria-label="Bridge base URL"
            className="font-mono"
          />
          <Input
            value={config.allowOrigin}
            onChange={(event) =>
              saveConfig({ ...config, allowOrigin: event.currentTarget.value })
            }
            placeholder="Allowed web origin"
            aria-label="Allowed web origin"
            className="font-mono"
          />
          <Input
            value={config.apiKey}
            onChange={(event) =>
              saveConfig({ ...config, apiKey: event.currentTarget.value })
            }
            placeholder="Client API key"
            aria-label="Client API key"
            type="password"
          />
          <Input
            value={config.defaultOpenFolder ?? ""}
            onChange={(event) =>
              saveConfig({ ...config, defaultOpenFolder: event.currentTarget.value })
            }
            placeholder="Optional folder for open-app (photos / field / studio)"
            aria-label="Bridge open-app initial folder"
            className="font-mono text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void startBridge()} disabled={busy}>
              <Power data-icon="inline-start" />
              Start bridge
            </Button>
            <Button type="button" variant="outline" onClick={() => void stopBridge()} disabled={busy}>
              <Square data-icon="inline-start" />
              Stop bridge
            </Button>
            <Button type="button" variant="outline" onClick={() => void refreshBridgeStatus()} disabled={busy}>
              Status
            </Button>
            <Button type="button" onClick={() => void testHttp()} disabled={busy}>
              <TestTube2 data-icon="inline-start" />
              Test HTTP
            </Button>
            <Button type="button" variant="outline" onClick={() => void fetchBridgeInfo()} disabled={busy}>
              <Info data-icon="inline-start" />
              Bridge info
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void openUrl(config.baseUrl)}
              disabled={!config.baseUrl.trim()}
            >
              <Globe data-icon="inline-start" />
              Open base URL
            </Button>
            <Button type="button" variant="outline" onClick={() => void fetchDashboardState()} disabled={busy}>
              Fetch dashboard state
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => void postOpenAppCommand("dashboard")} disabled={busy}>
              Open dashboard
            </Button>
            <Button type="button" variant="secondary" onClick={() => void postDashboardEditCommand({ editMode: true })} disabled={busy}>
              Enable edit mode
            </Button>
            <Button type="button" variant="outline" onClick={() => void postDashboardEditCommand({ layoutLocked: true })} disabled={busy}>
              Lock layout
            </Button>
            <Button type="button" variant="outline" onClick={() => void postDashboardEditCommand({ layoutLocked: false })} disabled={busy}>
              Unlock layout
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => void postOpenAppCommand("shoots_field")}
              disabled={busy || !(config.defaultOpenFolder ?? "").trim()}
            >
              Open field + folder
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void postDashboardLayoutCommand({
                  tools: { order: ["web", "workspace", "dropbox"] },
                })
              }
              disabled={busy}
            >
              Demo: reorder tools
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void postDashboardLayoutCommand({
                  internal: { sizes: { photos: "wide" } },
                })
              }
              disabled={busy}
            >
              Demo: widen Photos tile
            </Button>
          </div>
          {statusText ? (
            <p className="rounded-lg border px-3 py-2 text-sm text-muted-foreground">
              {statusText}
            </p>
          ) : null}
          {bridgeStatus ? (
            <p className="text-xs text-muted-foreground">
              Running: {String(bridgeStatus.running)} · Requests: {bridgeStatus.requestCount}
              {bridgeStatus.bindAddr ? ` · Bind: ${bridgeStatus.bindAddr}` : ""}
            </p>
          ) : null}
          {bridgeInfoPreview ? (
            <div className="rounded-lg border p-2">
              <p className="mb-1 text-xs text-muted-foreground">Bridge info (GET /api/bridge/info)</p>
              <pre className="max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap break-all">
                {bridgeInfoPreview}
              </pre>
            </div>
          ) : null}
          {dashboardStatePreview ? (
            <div className="rounded-lg border p-2">
              <p className="mb-1 text-xs text-muted-foreground">Dashboard state payload</p>
              <p className="max-h-28 overflow-auto font-mono text-xs break-all">
                {dashboardStatePreview}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-2">
          <CardTitle className="flex items-center gap-2">
            <Link2 />
            Integration notes
          </CardTitle>
          <CardDescription>
            Copy these values into your web app config/environment.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">HTTP endpoint</p>
            <p className="font-mono text-xs break-all">{config.baseUrl || "Not set"}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">WebSocket endpoint</p>
            <p className="font-mono text-xs break-all">{websocketUrl || "Invalid URL"}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Allowed origin</p>
            <p className="font-mono text-xs break-all">
              {config.allowOrigin || "Not set"}
            </p>
          </div>
          <Separator />
          <p className="text-xs text-muted-foreground">
            Commands: <span className="font-mono">POST /api/commands/open-app</span> body{" "}
            <span className="font-mono">{"{ app, initialFolder? }"}</span> (optional folder seeds the
            internal photo viewer for <span className="font-mono">photos</span>,{" "}
            <span className="font-mono">shoots_field</span>, <span className="font-mono">shoots_studio</span>
            ); <span className="font-mono">POST /api/commands/dashboard-edit</span>;{" "}
            <span className="font-mono">POST /api/commands/dashboard-layout</span> body{" "}
            <span className="font-mono">{"{ tools?: { order?, sizes? }, internal?: { order?, sizes? } }"}</span>.
            Optional <span className="font-mono">x-bridge-key</span> on all. Discovery:{" "}
            <span className="font-mono">GET /api/bridge/info</span>. Also:{" "}
            <span className="font-mono">GET /health</span>, <span className="font-mono">/api/dashboard/state</span>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
