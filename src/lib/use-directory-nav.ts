import { useCallback, useEffect, useState } from "react";

import {
  defaultLocalRoot,
  listDirectory,
  parentDirectory,
  type FsEntry,
} from "@/lib/tauri-fs";

type UseDirectoryNavOptions = {
  /** Fires before each `loadPath`; useful for clearing per-folder UI state. */
  onBeforeLoad?: () => void;
};

export type UseDirectoryNavResult = {
  currentPath: string;
  pathInput: string;
  entries: FsEntry[];
  loading: boolean;
  error: string | null;
  setPathInput: (value: string) => void;
  setError: (value: string | null) => void;
  loadPath: (path: string) => Promise<void>;
  submitPath: () => Promise<void>;
  goUp: () => Promise<void>;
  refresh: () => Promise<void>;
};

export function useDirectoryNav(
  options: UseDirectoryNavOptions = {},
): UseDirectoryNavResult {
  const { onBeforeLoad } = options;

  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPath = useCallback(
    async (path: string) => {
      const next = path.trim();
      if (!next) {
        return;
      }
      onBeforeLoad?.();
      setLoading(true);
      setError(null);
      try {
        const rows = await listDirectory(next);
        setEntries(rows);
        setCurrentPath(next);
        setPathInput(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [onBeforeLoad],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const root = await defaultLocalRoot();
        if (!cancelled) {
          await loadPath(root);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPath]);

  const submitPath = useCallback(async () => {
    await loadPath(pathInput);
  }, [loadPath, pathInput]);

  const goUp = useCallback(async () => {
    if (!currentPath) {
      return;
    }
    try {
      const parent = await parentDirectory(currentPath);
      if (parent) {
        await loadPath(parent);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [currentPath, loadPath]);

  const refresh = useCallback(async () => {
    if (!currentPath) {
      return;
    }
    await loadPath(currentPath);
  }, [currentPath, loadPath]);

  return {
    currentPath,
    pathInput,
    entries,
    loading,
    error,
    setPathInput,
    setError,
    loadPath,
    submitPath,
    goUp,
    refresh,
  };
}
