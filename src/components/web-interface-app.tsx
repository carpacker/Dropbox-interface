import { openUrl } from "@tauri-apps/plugin-opener";
import { Globe, Link2, PlugZap, Power, Square, TestTube2 } from "lucide-react";
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
import { webBridgeStart, webBridgeStatus, webBridgeStop, type WebBridgeStatus } from "@/lib/web-bridge";

const WEB_BRIDGE_CONFIG_KEY = "dropbox-interface:web-bridge-config";

type WebBridgeConfig = {
  baseUrl: string;
  apiKey: string;
  allowOrigin: string;
};

function restoreConfig(): WebBridgeConfig {
  const fallback: WebBridgeConfig = {
    baseUrl: "http://localhost:1420",
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
      const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/health`, {
        method: "GET",
        headers: config.apiKey
          ? {
              "x-bridge-key": config.apiKey,
            }
          : undefined,
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
      const res = await fetch(`${config.baseUrl.replace(/\/+$/, "")}/api/dashboard/state`, {
        method: "GET",
        headers: config.apiKey ? { "x-bridge-key": config.apiKey } : undefined,
      });
      const text = await res.text();
      setDashboardStatePreview(text);
      setStatusText(`Dashboard state endpoint: ${res.status} ${res.statusText}`);
    } catch (e) {
      setStatusText(`Dashboard state fetch failed: ${e instanceof Error ? e.message : String(e)}`);
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
            Live bridge now exposes `/health` and `/api/bridge/status` with optional `x-bridge-key`.
            Use this panel to start/stop bridge runtime and validate web-client access.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
