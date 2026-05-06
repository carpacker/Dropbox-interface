import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  UNIX_SHELL_OPTIONS,
  WINDOWS_SHELL_OPTIONS,
  defaultShellId,
  isLikelyWindows,
  loadTerminalShellId,
  saveTerminalShellId,
  type TerminalShellId,
} from "@/lib/terminal-preferences";
import {
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "@/lib/tauri-terminal";

import "@xterm/xterm/css/xterm.css";

function shellLabel(id: TerminalShellId): string {
  const opts = isLikelyWindows() ? WINDOWS_SHELL_OPTIONS : UNIX_SHELL_OPTIONS;
  return opts.find((o) => o.value === id)?.label ?? id;
}

function termColors() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const bg = styles.getPropertyValue("--background").trim() || "#ffffff";
  const fg = styles.getPropertyValue("--foreground").trim() || "#0a0a0a";
  const muted =
    styles.getPropertyValue("--muted-foreground").trim() || "#737373";
  const accent = styles.getPropertyValue("--primary").trim() || "#171717";
  return {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: `${fg}33`,
    selectionForeground: fg,
    selectionInactiveBackground: `${muted}44`,
  };
}

type DesktopTerminalProps = {
  /** When false, skips PTY resize (tab hidden avoids 0×0 geometry). */
  active: boolean;
};

export function DesktopTerminal({ active }: DesktopTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeFrameRef = useRef<number>(0);

  const shellIdRef = useRef<TerminalShellId>(loadTerminalShellId());
  const [shellId, setShellId] = useState<TerminalShellId>(() => {
    const stored = loadTerminalShellId();
    shellIdRef.current = stored;
    return stored;
  });

  const [bootError, setBootError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("Starting…");

  const detachListeners = useCallback(() => {
    for (const u of unlistenRef.current) {
      u();
    }
    unlistenRef.current = [];
  }, []);

  const resizePty = useCallback(async () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit || !activeRef.current) {
      return;
    }
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;
    if (cols <= 0 || rows <= 0) {
      return;
    }
    try {
      await terminalResize(cols, rows);
    } catch {
      /* PTY may not be running yet */
    }
  }, []);

  const spawnOrRestartShell = useCallback(async () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) {
      return;
    }
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;
    if (cols <= 0 || rows <= 0) {
      return;
    }
    setBootError(null);
    setStatus("Connecting shell…");
    try {
      await terminalKill();
    } catch {
      /* cold start */
    }
    try {
      await terminalSpawn(shellIdRef.current, cols, rows);
      setStatus(`${shellLabel(shellIdRef.current)} · ${cols}×${rows}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBootError(msg);
      setStatus("Could not start shell");
    }
  }, []);

  const onShellChoice = useCallback(
    async (next: TerminalShellId) => {
      const normalized =
        isLikelyWindows() && (next === "login" || next === "sh" || next === "bash")
          ? defaultShellId()
          : !isLikelyWindows() &&
              (next === "powershell" || next === "cmd" || next === "pwsh")
            ? defaultShellId()
            : next;

      saveTerminalShellId(normalized);
      shellIdRef.current = normalized;
      setShellId(normalized);
      await spawnOrRestartShell();
    },
    [spawnOrRestartShell],
  );

  useEffect(() => {
    if (!active) {
      return;
    }
    const id = requestAnimationFrame(() => {
      void resizePty();
    });
    return () => cancelAnimationFrame(id);
  }, [active, resizePty]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      theme: termColors(),
      scrollback: 5000,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const writeSub = term.onData((data) => {
      void terminalWrite(data).catch(() => {
        /* disconnected */
      });
    });

    void (async () => {
      try {
        const uOut = await listen<{ data: string }>("terminal-output", (ev) => {
          term.write(ev.payload.data);
        });
        const uExit = await listen<{ reason: string }>("terminal-exit", () => {
          setStatus("Shell exited");
        });
        unlistenRef.current = [uOut, uExit];
      } catch (e) {
        setBootError(e instanceof Error ? e.message : String(e));
        setStatus("Event listener failed — run inside Tauri");
      }

      await spawnOrRestartShell();
    })();

    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(() => {
        void resizePty();
      });
    });
    ro.observe(container);
    resizeObserverRef.current = ro;

    const onScheme = () => {
      term.options.theme = termColors();
    };
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", onScheme);

    return () => {
      mq.removeEventListener("change", onScheme);
      detachListeners();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      cancelAnimationFrame(resizeFrameRef.current);
      writeSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      void terminalKill().catch(() => {});
    };
  }, [detachListeners, resizePty, spawnOrRestartShell]);

  const shellOptions = isLikelyWindows()
    ? WINDOWS_SHELL_OPTIONS
    : UNIX_SHELL_OPTIONS;

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <CardTitle>Terminal</CardTitle>
          <CardDescription>
            Local PTY. Shell choice is remembered in browser storage for this app.
            Session stays alive when you switch to other tabs after opening
            Terminal once.
          </CardDescription>
        </div>
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              Shell profile
            </span>
            <Select
              value={shellId}
              onValueChange={(v) => void onShellChoice(v as TerminalShellId)}
            >
              <SelectTrigger className="w-full min-w-[12rem] sm:w-56">
                <SelectValue placeholder="Pick a shell" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{isLikelyWindows() ? "Windows" : "Unix"}</SelectLabel>
                  {shellOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void spawnOrRestartShell()}
          >
            <RotateCcw data-icon="inline-start" />
            Restart shell
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-4">
        <p className="text-xs text-muted-foreground">{status}</p>
        {bootError ? (
          <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {bootError}
          </p>
        ) : null}
        <div
          ref={containerRef}
          className="h-[min(55vh,520px)] w-full overflow-hidden rounded-lg border bg-background"
        />
      </CardContent>
    </Card>
  );
}
