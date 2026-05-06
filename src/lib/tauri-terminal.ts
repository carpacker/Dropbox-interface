import { invoke } from "@tauri-apps/api/core";

export function terminalSpawn(cols: number, rows: number) {
  return invoke<void>("terminal_spawn", { cols, rows });
}

export function terminalWrite(data: string) {
  return invoke<void>("terminal_write", { data });
}

export function terminalResize(cols: number, rows: number) {
  return invoke<void>("terminal_resize", { cols, rows });
}

export function terminalKill() {
  return invoke<void>("terminal_kill");
}
