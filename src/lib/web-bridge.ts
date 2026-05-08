import { invoke } from "@tauri-apps/api/core";

/** Discovery payload from `GET /api/bridge/info` (shape is stable; extend as the bridge grows). */
export type BridgeInfoResponse = {
  ok?: boolean;
  service?: string;
  version?: string;
  endpoints?: unknown[];
  headers?: { optional?: string[] };
  runtime?: {
    requiresApiKey?: boolean;
    allowOrigin?: string;
  };
  limits?: {
    maxJsonBodyBytes?: number;
  };
};

export type WebBridgeStatus = {
  running: boolean;
  bindAddr: string | null;
  allowOrigin: string | null;
  hasApiKey: boolean;
  requestCount: number;
  lastError: string | null;
};

export type DashboardEditCommand = {
  editMode?: boolean;
  layoutLocked?: boolean;
};

export type OpenAppCommand = {
  app: string;
  initialFolder?: string | null;
};

export type LayoutLanePatch = {
  order?: string[];
  sizes?: Record<string, string>;
};

export type DashboardLayoutCommand = {
  tools?: LayoutLanePatch;
  internal?: LayoutLanePatch;
};

/** Normalized base (no trailing slash) for `fetch` calls to the embedded HTTP bridge. */
export function bridgeNormalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function bridgeAuthHeader(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { "x-bridge-key": apiKey } : {};
}

export function prettifyJsonText(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * GET helper for browser-side integration tests and external scripts.
 * Expects `init.headers` to be a plain object if merged (see Web Interface).
 */
export function bridgeHttpGet(
  baseUrl: string,
  path: string,
  apiKey?: string,
  init?: RequestInit,
): Promise<Response> {
  const base = bridgeNormalizedBaseUrl(baseUrl);
  const p = path.startsWith("/") ? path : `/${path}`;
  const extra = init?.headers as Record<string, string> | undefined;
  return fetch(`${base}${p}`, {
    ...init,
    headers: { ...bridgeAuthHeader(apiKey), ...extra },
  });
}

export function bridgeHttpPostJson(
  baseUrl: string,
  path: string,
  body: unknown,
  apiKey?: string,
  init?: RequestInit,
): Promise<Response> {
  const base = bridgeNormalizedBaseUrl(baseUrl);
  const p = path.startsWith("/") ? path : `/${path}`;
  const extra = init?.headers as Record<string, string> | undefined;
  return fetch(`${base}${p}`, {
    ...init,
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bridgeAuthHeader(apiKey),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

export function webBridgeStart(params: {
  bindAddr: string;
  allowOrigin: string;
  apiKey: string;
}) {
  return invoke<WebBridgeStatus>("web_bridge_start", params);
}

export function webBridgeStop() {
  return invoke<WebBridgeStatus>("web_bridge_stop");
}

export function webBridgeStatus() {
  return invoke<WebBridgeStatus>("web_bridge_status");
}

export function webBridgeSetDashboardState(state: unknown) {
  return invoke<void>("web_bridge_set_dashboard_state", {
    stateJson: JSON.stringify(state),
  });
}

export function webBridgeTakeOpenAppCommand() {
  return invoke<OpenAppCommand | null>("web_bridge_take_open_app_command");
}

export function webBridgeTakeDashboardEditCommand() {
  return invoke<DashboardEditCommand | null>("web_bridge_take_dashboard_edit_command");
}

export function webBridgeTakeDashboardLayoutCommand() {
  return invoke<DashboardLayoutCommand | null>("web_bridge_take_dashboard_layout_command");
}
