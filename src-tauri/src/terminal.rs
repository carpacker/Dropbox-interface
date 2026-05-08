use portable_pty::{
    native_pty_system, Child, CommandBuilder, MasterPty, PtySize,
};
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub data: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    pub reason: String,
}

pub struct TerminalSession {
    inner: Mutex<TerminalInner>,
}

#[derive(Default)]
struct TerminalInner {
    master: Option<Box<dyn MasterPty + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    child: Option<Box<dyn Child + Send + Sync>>,
    reader_stop: Option<Arc<AtomicBool>>,
}

impl Default for TerminalSession {
    fn default() -> Self {
        Self {
            inner: Mutex::new(TerminalInner::default()),
        }
    }
}

fn build_shell_command(shell: &str) -> Result<CommandBuilder, String> {
    let key = shell.trim();
    #[cfg(windows)]
    {
        match key {
            "powershell" | "" => {
                let mut cmd = CommandBuilder::new("powershell.exe");
                cmd.arg("-NoLogo");
                Ok(cmd)
            }
            "cmd" => Ok(CommandBuilder::new("cmd.exe")),
            "pwsh" => {
                let mut cmd = CommandBuilder::new("pwsh");
                cmd.arg("-NoLogo");
                Ok(cmd)
            }
            other => Err(format!(
                "Unknown shell \"{}\". Use powershell, cmd, or pwsh.",
                other
            )),
        }
    }
    #[cfg(not(windows))]
    {
        match key {
            "login" | "posix" | "" => {
                let sh = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
                Ok(CommandBuilder::new(sh))
            }
            "sh" => Ok(CommandBuilder::new("/bin/sh")),
            "bash" => Ok(CommandBuilder::new("/bin/bash")),
            other => Err(format!(
                "Unknown shell \"{}\". Use login, sh, or bash.",
                other
            )),
        }
    }
}

impl TerminalSession {
    fn kill_inner(&self) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "terminal mutex poisoned".to_string())?;

        if let Some(stop) = inner.reader_stop.take() {
            stop.store(true, Ordering::SeqCst);
        }

        if let Some(mut child) = inner.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        inner.writer.take();
        inner.master.take();

        Ok(())
    }

    pub fn spawn(
        &self,
        app: AppHandle,
        shell: String,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        self.kill_inner()?;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let slave = pair.slave;
        let master = pair.master;

        let cmd = build_shell_command(&shell)?;
        let child = slave.spawn_command(cmd).map_err(|e| e.to_string())?;
        drop(slave);

        let reader = master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = master.take_writer().map_err(|e| e.to_string())?;

        let stop = Arc::new(AtomicBool::new(false));
        let stop_reader = Arc::clone(&stop);
        let app_reader = app.clone();

        {
            let mut inner = self
                .inner
                .lock()
                .map_err(|_| "terminal mutex poisoned".to_string())?;
            inner.master = Some(master);
            inner.writer = Some(writer);
            inner.child = Some(child);
            inner.reader_stop = Some(stop);
        }

        thread::spawn(move || {
            let mut reader = reader;
            let mut buf = [0u8; 8192];
            loop {
                if stop_reader.load(Ordering::SeqCst) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                        let _ = app_reader.emit(
                            "terminal-output",
                            TerminalChunk { data },
                        );
                    }
                    Err(_) => break,
                }
            }
            let _ = app_reader.emit(
                "terminal-exit",
                TerminalExitPayload {
                    reason: "closed".into(),
                },
            );
        });

        Ok(())
    }

    pub fn write_input(&self, data: String) -> Result<(), String> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "terminal mutex poisoned".to_string())?;
        let writer = inner
            .writer
            .as_mut()
            .ok_or_else(|| "terminal is not running".to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        let inner = self
            .inner
            .lock()
            .map_err(|_| "terminal mutex poisoned".to_string())?;
        let master = inner
            .master
            .as_ref()
            .ok_or_else(|| "terminal is not running".to_string())?;
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn kill(&self) -> Result<(), String> {
        self.kill_inner()
    }
}

#[tauri::command]
pub fn terminal_spawn(
    app: AppHandle,
    session: State<'_, TerminalSession>,
    shell: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    session.spawn(app, shell, cols, rows)
}

#[tauri::command]
pub fn terminal_write(session: State<'_, TerminalSession>, data: String) -> Result<(), String> {
    session.write_input(data)
}

#[tauri::command]
pub fn terminal_resize(
    session: State<'_, TerminalSession>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    session.resize(cols, rows)
}

#[tauri::command]
pub fn terminal_kill(session: State<'_, TerminalSession>) -> Result<(), String> {
    session.kill()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn unix_login_shell_resolves_without_panic() {
        // succeeds whether or not $SHELL is set: falls back to /bin/sh
        assert!(build_shell_command("login").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn unix_explicit_shells_are_accepted() {
        assert!(build_shell_command("sh").is_ok());
        assert!(build_shell_command("bash").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn unix_legacy_posix_alias_is_accepted() {
        assert!(build_shell_command("posix").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn unix_empty_string_is_accepted_and_uses_login_default() {
        assert!(build_shell_command("").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn unix_unknown_shell_is_rejected_with_helpful_message() {
        let err = build_shell_command("zsh").unwrap_err();
        assert!(err.contains("Unknown shell"), "got: {err}");
        assert!(err.contains("login"), "expected hint listing supported shells");
    }

    #[cfg(unix)]
    #[test]
    fn unix_shell_string_is_trimmed() {
        assert!(build_shell_command("  bash  ").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn windows_explicit_shells_are_accepted() {
        assert!(build_shell_command("powershell").is_ok());
        assert!(build_shell_command("cmd").is_ok());
        assert!(build_shell_command("pwsh").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn windows_empty_string_uses_powershell_default() {
        assert!(build_shell_command("").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn windows_unknown_shell_is_rejected() {
        let err = build_shell_command("zsh").unwrap_err();
        assert!(err.contains("Unknown shell"));
    }
}
