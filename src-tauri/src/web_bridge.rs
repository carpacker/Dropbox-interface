use serde::Serialize;
use std::collections::HashMap;
use std::io::Write;
use std::net::TcpStream;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;
use tauri::State;
use tiny_http::{Header, Method, Response, Server, StatusCode};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebBridgeStatus {
    pub running: bool,
    pub bind_addr: Option<String>,
    pub allow_origin: Option<String>,
    pub has_api_key: bool,
    pub request_count: u64,
    pub last_error: Option<String>,
}

#[derive(Clone)]
struct BridgeConfig {
    bind_addr: String,
    allow_origin: String,
    api_key: String,
}

struct BridgeRuntime {
    config: BridgeConfig,
    stop: Arc<AtomicBool>,
    join: JoinHandle<()>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardEditCommand {
    pub edit_mode: Option<bool>,
    pub layout_locked: Option<bool>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenAppCommand {
    pub app: String,
    #[serde(default)]
    pub initial_folder: Option<String>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutLanePatch {
    #[serde(default)]
    pub order: Option<Vec<String>>,
    #[serde(default)]
    pub sizes: Option<HashMap<String, String>>,
}

#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLayoutCommand {
    #[serde(default)]
    pub tools: Option<LayoutLanePatch>,
    #[serde(default)]
    pub internal: Option<LayoutLanePatch>,
}

pub struct WebBridgeManager {
    runtime: Mutex<Option<BridgeRuntime>>,
    request_count: Arc<AtomicU64>,
    last_error: Arc<Mutex<Option<String>>>,
    dashboard_state_json: Arc<Mutex<String>>,
    pending_open_app: Arc<Mutex<Option<OpenAppCommand>>>,
    pending_dashboard_edit: Arc<Mutex<Option<DashboardEditCommand>>>,
    pending_dashboard_layout: Arc<Mutex<Option<DashboardLayoutCommand>>>,
}

impl Default for WebBridgeManager {
    fn default() -> Self {
        Self {
            runtime: Mutex::new(None),
            request_count: Arc::new(AtomicU64::new(0)),
            last_error: Arc::new(Mutex::new(None)),
            dashboard_state_json: Arc::new(Mutex::new("{}".to_string())),
            pending_open_app: Arc::new(Mutex::new(None)),
            pending_dashboard_edit: Arc::new(Mutex::new(None)),
            pending_dashboard_layout: Arc::new(Mutex::new(None)),
        }
    }
}

fn cors_headers(allow_origin: &str) -> [Header; 4] {
    [
        Header::from_bytes("content-type", "application/json").unwrap(),
        Header::from_bytes("access-control-allow-origin", allow_origin).unwrap(),
        Header::from_bytes("access-control-allow-methods", "GET,POST,OPTIONS").unwrap(),
        Header::from_bytes("access-control-allow-headers", "content-type,x-bridge-key").unwrap(),
    ]
}

fn respond_json(req: tiny_http::Request, status: u16, body: String, allow_origin: &str) {
    let mut res = Response::from_string(body).with_status_code(StatusCode(status));
    for h in cors_headers(allow_origin) {
        res.add_header(h);
    }
    let _ = req.respond(res);
}

impl WebBridgeManager {
    fn write_last_error(&self, value: Option<String>) {
        if let Ok(mut guard) = self.last_error.lock() {
            *guard = value;
        }
    }

    fn stop_internal(&self) -> Result<(), String> {
        let mut runtime_guard = self
            .runtime
            .lock()
            .map_err(|_| "web bridge mutex poisoned".to_string())?;
        if let Some(runtime) = runtime_guard.take() {
            runtime.stop.store(true, Ordering::SeqCst);
            if let Ok(mut stream) = TcpStream::connect(&runtime.config.bind_addr) {
                let _ = stream.write_all(b"GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n");
            }
            let _ = runtime.join.join();
        }
        Ok(())
    }

    fn start_internal(&self, bind_addr: String, allow_origin: String, api_key: String) -> Result<(), String> {
        self.stop_internal()?;

        let server = Server::http(&bind_addr).map_err(|e| e.to_string())?;
        let stop = Arc::new(AtomicBool::new(false));
        let stop_for_thread = Arc::clone(&stop);
        let count = Arc::clone(&self.request_count);
        let allow_origin_for_thread = allow_origin.clone();
        let api_key_for_thread = api_key.clone();
        let error_store = Arc::clone(&self.last_error);
        let dashboard_state = Arc::clone(&self.dashboard_state_json);
        let open_app_queue = Arc::clone(&self.pending_open_app);
        let dashboard_edit_queue = Arc::clone(&self.pending_dashboard_edit);
        let dashboard_layout_queue = Arc::clone(&self.pending_dashboard_layout);

        self.request_count.store(0, Ordering::SeqCst);
        self.write_last_error(None);

        let join = std::thread::spawn(move || {
            loop {
                if stop_for_thread.load(Ordering::SeqCst) {
                    break;
                }

                let mut req = match server.recv_timeout(Duration::from_millis(300)) {
                    Ok(Some(req)) => req,
                    Ok(None) => continue,
                    Err(err) => {
                        if let Ok(mut guard) = error_store.lock() {
                            *guard = Some(err.to_string());
                        }
                        continue;
                    }
                };

                count.fetch_add(1, Ordering::SeqCst);

                if req.method() == &Method::Options {
                    respond_json(req, 204, String::new(), &allow_origin_for_thread);
                    continue;
                }

                if !api_key_for_thread.is_empty() {
                    let key = req
                        .headers()
                        .iter()
                        .find(|h| h.field.equiv("x-bridge-key"))
                        .map(|h| h.value.to_string())
                        .unwrap_or_default();
                    if key != api_key_for_thread {
                        respond_json(
                            req,
                            401,
                            "{\"error\":\"invalid API key\"}".to_string(),
                            &allow_origin_for_thread,
                        );
                        continue;
                    }
                }

                let path = req.url().split('?').next().unwrap_or(req.url());
                match (req.method(), path) {
                    (&Method::Get, "/health") => {
                        respond_json(
                            req,
                            200,
                            "{\"ok\":true,\"service\":\"dropbox-interface-web-bridge\"}".to_string(),
                            &allow_origin_for_thread,
                        );
                    }
                    (&Method::Get, "/api/bridge/info") => {
                        let info = serde_json::json!({
                            "ok": true,
                            "service": "dropbox-interface-web-bridge",
                            "version": env!("CARGO_PKG_VERSION"),
                            "endpoints": [
                                {
                                    "method": "GET",
                                    "path": "/health",
                                    "description": "Liveness probe; no auth required when API key is unset (same as other routes once key is configured).",
                                },
                                {
                                    "method": "GET",
                                    "path": "/api/bridge/status",
                                    "description": "Bridge request count and allowed CORS origin (reflects running config).",
                                },
                                {
                                    "method": "GET",
                                    "path": "/api/bridge/info",
                                    "description": "Machine-readable list of routes and payload hints.",
                                },
                                {
                                    "method": "GET",
                                    "path": "/api/dashboard/state",
                                    "description": "Last dashboard snapshot JSON published by the desktop app.",
                                },
                                {
                                    "method": "POST",
                                    "path": "/api/commands/open-app",
                                    "body": {
                                        "app": "dashboard | workspace | dropbox | web | photos | social_media | shoots_field | shoots_studio | assets",
                                        "initialFolder": "optional string — seeds internal photo viewers",
                                    },
                                },
                                {
                                    "method": "POST",
                                    "path": "/api/commands/dashboard-edit",
                                    "body": {
                                        "editMode": "optional boolean",
                                        "layoutLocked": "optional boolean",
                                    },
                                },
                                {
                                    "method": "POST",
                                    "path": "/api/commands/dashboard-layout",
                                    "body": {
                                        "tools": "optional { order?: string[], sizes?: Record<string,string> }",
                                        "internal": "optional { order?: string[], sizes?: Record<string,string> }",
                                    },
                                },
                            ],
                            "headers": {
                                "optional": ["x-bridge-key — required when bridge is started with a non-empty API key"],
                            },
                        });
                        respond_json(
                            req,
                            200,
                            info.to_string(),
                            &allow_origin_for_thread,
                        );
                    }
                    (&Method::Get, "/api/bridge/status") => {
                        let payload = format!(
                            "{{\"ok\":true,\"requestCount\":{},\"allowOrigin\":\"{}\"}}",
                            count.load(Ordering::SeqCst),
                            allow_origin_for_thread.replace('"', "\\\"")
                        );
                        respond_json(req, 200, payload, &allow_origin_for_thread);
                    }
                    (&Method::Get, "/api/dashboard/state") => {
                        let dashboard_json = dashboard_state
                            .lock()
                            .map(|s| s.clone())
                            .unwrap_or_else(|_| "{}".to_string());
                        let payload = format!(
                            "{{\"ok\":true,\"state\":{}}}",
                            dashboard_json
                        );
                        respond_json(req, 200, payload, &allow_origin_for_thread);
                    }
                    (&Method::Post, "/api/commands/open-app") => {
                        let mut body = String::new();
                        let reader = req.as_reader();
                        if reader.read_to_string(&mut body).is_err() {
                            respond_json(
                                req,
                                400,
                                "{\"error\":\"invalid request body\"}".to_string(),
                                &allow_origin_for_thread,
                            );
                            continue;
                        }
                        let parsed: Result<OpenAppCommand, _> = serde_json::from_str(&body);
                        let cmd = match parsed {
                            Ok(c) => c,
                            Err(_) => {
                                respond_json(
                                    req,
                                    400,
                                    "{\"error\":\"invalid request body\"}".to_string(),
                                    &allow_origin_for_thread,
                                );
                                continue;
                            }
                        };
                        match cmd.app.as_str() {
                            "dashboard"
                            | "workspace"
                            | "dropbox"
                            | "web"
                            | "photos"
                            | "social_media"
                            | "shoots_field"
                            | "shoots_studio"
                            | "assets" => {
                                if let Ok(mut queue) = open_app_queue.lock() {
                                    *queue = Some(cmd);
                                }
                                respond_json(
                                    req,
                                    200,
                                    "{\"ok\":true}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                            _ => {
                                respond_json(
                                    req,
                                    400,
                                    "{\"error\":\"invalid app target\"}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                        }
                    }
                    (&Method::Post, "/api/commands/dashboard-edit") => {
                        let mut body = String::new();
                        let reader = req.as_reader();
                        if reader.read_to_string(&mut body).is_err() {
                            respond_json(
                                req,
                                400,
                                "{\"error\":\"invalid request body\"}".to_string(),
                                &allow_origin_for_thread,
                            );
                            continue;
                        }

                        let parsed: Result<DashboardEditCommand, _> = serde_json::from_str(&body);
                        match parsed {
                            Ok(cmd) if cmd.edit_mode.is_some() || cmd.layout_locked.is_some() => {
                                if let Ok(mut queue) = dashboard_edit_queue.lock() {
                                    *queue = Some(cmd);
                                }
                                respond_json(
                                    req,
                                    200,
                                    "{\"ok\":true}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                            _ => {
                                respond_json(
                                    req,
                                    400,
                                    "{\"error\":\"invalid dashboard edit command\"}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                        }
                    }
                    (&Method::Post, "/api/commands/dashboard-layout") => {
                        let mut body = String::new();
                        let reader = req.as_reader();
                        if reader.read_to_string(&mut body).is_err() {
                            respond_json(
                                req,
                                400,
                                "{\"error\":\"invalid request body\"}".to_string(),
                                &allow_origin_for_thread,
                            );
                            continue;
                        }
                        let parsed: Result<DashboardLayoutCommand, _> = serde_json::from_str(&body);
                        match parsed {
                            Ok(cmd) => {
                                let has_tools = cmd
                                    .tools
                                    .as_ref()
                                    .map(|t| t.order.is_some() || t.sizes.is_some())
                                    .unwrap_or(false);
                                let has_internal = cmd
                                    .internal
                                    .as_ref()
                                    .map(|t| t.order.is_some() || t.sizes.is_some())
                                    .unwrap_or(false);
                                if !has_tools && !has_internal {
                                    respond_json(
                                        req,
                                        400,
                                        "{\"error\":\"tools or internal patch required\"}".to_string(),
                                        &allow_origin_for_thread,
                                    );
                                    continue;
                                }
                                if let Ok(mut queue) = dashboard_layout_queue.lock() {
                                    *queue = Some(cmd);
                                }
                                respond_json(
                                    req,
                                    200,
                                    "{\"ok\":true}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                            Err(_) => {
                                respond_json(
                                    req,
                                    400,
                                    "{\"error\":\"invalid dashboard layout command\"}".to_string(),
                                    &allow_origin_for_thread,
                                );
                            }
                        }
                    }
                    _ => {
                        respond_json(
                            req,
                            404,
                            "{\"error\":\"endpoint not found\"}".to_string(),
                            &allow_origin_for_thread,
                        );
                    }
                }
            }
        });

        let runtime = BridgeRuntime {
            config: BridgeConfig {
                bind_addr,
                allow_origin,
                api_key,
            },
            stop,
            join,
        };

        let mut runtime_guard = self
            .runtime
            .lock()
            .map_err(|_| "web bridge mutex poisoned".to_string())?;
        *runtime_guard = Some(runtime);
        Ok(())
    }

    fn status_internal(&self) -> Result<WebBridgeStatus, String> {
        let runtime_guard = self
            .runtime
            .lock()
            .map_err(|_| "web bridge mutex poisoned".to_string())?;
        let last_error = self
            .last_error
            .lock()
            .map_err(|_| "web bridge error mutex poisoned".to_string())?
            .clone();
        if let Some(runtime) = runtime_guard.as_ref() {
            Ok(WebBridgeStatus {
                running: true,
                bind_addr: Some(runtime.config.bind_addr.clone()),
                allow_origin: Some(runtime.config.allow_origin.clone()),
                has_api_key: !runtime.config.api_key.is_empty(),
                request_count: self.request_count.load(Ordering::SeqCst),
                last_error,
            })
        } else {
            Ok(WebBridgeStatus {
                running: false,
                bind_addr: None,
                allow_origin: None,
                has_api_key: false,
                request_count: self.request_count.load(Ordering::SeqCst),
                last_error,
            })
        }
    }

    fn set_dashboard_state_internal(&self, state_json: String) -> Result<(), String> {
        let _: serde_json::Value = serde_json::from_str(&state_json)
            .map_err(|e| format!("invalid dashboard state JSON: {}", e))?;
        let mut guard = self
            .dashboard_state_json
            .lock()
            .map_err(|_| "web bridge dashboard state mutex poisoned".to_string())?;
        *guard = state_json;
        Ok(())
    }

    fn take_open_app_command_internal(&self) -> Result<Option<OpenAppCommand>, String> {
        let mut guard = self
            .pending_open_app
            .lock()
            .map_err(|_| "web bridge open-app queue mutex poisoned".to_string())?;
        Ok(guard.take())
    }

    fn take_dashboard_edit_command_internal(&self) -> Result<Option<DashboardEditCommand>, String> {
        let mut guard = self
            .pending_dashboard_edit
            .lock()
            .map_err(|_| "web bridge dashboard-edit queue mutex poisoned".to_string())?;
        Ok(guard.take())
    }

    fn take_dashboard_layout_command_internal(
        &self,
    ) -> Result<Option<DashboardLayoutCommand>, String> {
        let mut guard = self
            .pending_dashboard_layout
            .lock()
            .map_err(|_| "web bridge dashboard-layout queue mutex poisoned".to_string())?;
        Ok(guard.take())
    }
}

#[tauri::command]
pub fn web_bridge_start(
    bridge: State<'_, WebBridgeManager>,
    bind_addr: String,
    allow_origin: String,
    api_key: String,
) -> Result<WebBridgeStatus, String> {
    bridge.start_internal(bind_addr, allow_origin, api_key)?;
    bridge.status_internal()
}

#[tauri::command]
pub fn web_bridge_stop(bridge: State<'_, WebBridgeManager>) -> Result<WebBridgeStatus, String> {
    bridge.stop_internal()?;
    bridge.status_internal()
}

#[tauri::command]
pub fn web_bridge_status(bridge: State<'_, WebBridgeManager>) -> Result<WebBridgeStatus, String> {
    bridge.status_internal()
}

#[tauri::command]
pub fn web_bridge_set_dashboard_state(
    bridge: State<'_, WebBridgeManager>,
    state_json: String,
) -> Result<(), String> {
    bridge.set_dashboard_state_internal(state_json)
}

#[tauri::command]
pub fn web_bridge_take_open_app_command(
    bridge: State<'_, WebBridgeManager>,
) -> Result<Option<OpenAppCommand>, String> {
    bridge.take_open_app_command_internal()
}

#[tauri::command]
pub fn web_bridge_take_dashboard_edit_command(
    bridge: State<'_, WebBridgeManager>,
) -> Result<Option<DashboardEditCommand>, String> {
    bridge.take_dashboard_edit_command_internal()
}

#[tauri::command]
pub fn web_bridge_take_dashboard_layout_command(
    bridge: State<'_, WebBridgeManager>,
) -> Result<Option<DashboardLayoutCommand>, String> {
    bridge.take_dashboard_layout_command_internal()
}
