const STORAGE_KEY = "dropbox-interface:terminal-shell";

/** Windows: powershell | cmd | pwsh. macOS/Linux: login | sh | bash */
export type TerminalShellId =
  | "powershell"
  | "cmd"
  | "pwsh"
  | "login"
  | "sh"
  | "bash";

export function isLikelyWindows(): boolean {
  return /Win/i.test(navigator.userAgent);
}

export function defaultShellId(): TerminalShellId {
  return isLikelyWindows() ? "powershell" : "login";
}

function normalizeWindows(raw: string): TerminalShellId | null {
  if (raw === "powershell" || raw === "cmd" || raw === "pwsh") {
    return raw;
  }
  return null;
}

function normalizeUnix(raw: string): TerminalShellId | null {
  if (raw === "login" || raw === "sh" || raw === "bash") {
    return raw;
  }
  if (raw === "posix") {
    return "login";
  }
  return null;
}

export function loadTerminalShellId(): TerminalShellId {
  const fallback = defaultShellId();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const normalized = isLikelyWindows()
      ? normalizeWindows(raw)
      : normalizeUnix(raw);
    return normalized ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveTerminalShellId(id: TerminalShellId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* private mode / quota */
  }
}

export const WINDOWS_SHELL_OPTIONS: ReadonlyArray<{
  value: TerminalShellId;
  label: string;
}> = [
  { value: "powershell", label: "PowerShell" },
  { value: "cmd", label: "Command Prompt" },
  { value: "pwsh", label: "PowerShell 7 (pwsh)" },
];

export const UNIX_SHELL_OPTIONS: ReadonlyArray<{
  value: TerminalShellId;
  label: string;
}> = [
  { value: "login", label: "Login shell ($SHELL)" },
  { value: "sh", label: "/bin/sh" },
  { value: "bash", label: "/bin/bash" },
];
