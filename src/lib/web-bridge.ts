import { invoke } from "@tauri-apps/api/core";

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
