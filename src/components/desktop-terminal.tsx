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
  terminalKill,
  terminalResize,
  terminalSpawn,
  terminalWrite,
} from "@/lib/tauri-terminal";

import "@xterm/xterm/css/xterm.css";

function termColors() {
  const root = document.documentElement;
  const styles = getComputedStyle(root);
  const bg = styles.getPropertyValue("--background").trim() || "#ffffff";
  const fg = styles.getPropertyValue("--foreground").trim() || "#0a0a0a";
  const muted = styles.getPropertyValue("--muted-foreground").trim() || "#737373";
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

export function DesktopTerminal() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const resizeFrameRef = useRef<number>(0);

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
    if (!term || !fit) {
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

  const bootShell = useCallback(async () => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) {
      return;
    }
    fit.fit();
    const cols = term.cols;
    const rows = term.rows;
    setBootError(null);
    setStatus("Connecting shell…");
    try {
      await terminalKill();
    } catch {
      /* first boot */
    }
    try {
      await terminalSpawn(cols, rows);
      setStatus(`Shell · ${cols}×${rows}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setBootError(msg);
      setStatus("Could not start shell");
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
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

      await bootShell();
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
  }, [bootShell, detachListeners, resizePty]);

  return (
    <Card className="flex flex-col gap-0 overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="flex flex-col gap-1">
          <CardTitle>Terminal</CardTitle>
          <CardDescription>
            Local PTY (PowerShell on Windows, <code className="font-mono text-xs">$SHELL</code>{" "}
            elsewhere). Resize the pane to update the pty geometry.
          </CardDescription>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void bootShell()}
        >
          <RotateCcw data-icon="inline-start" />
          Restart shell
        </Button>
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
