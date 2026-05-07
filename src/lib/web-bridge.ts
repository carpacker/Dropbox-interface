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
  return invoke<string | null>("web_bridge_take_open_app_command");
}

export function webBridgeTakeDashboardEditCommand() {
  return invoke<DashboardEditCommand | null>("web_bridge_take_dashboard_edit_command");
}
