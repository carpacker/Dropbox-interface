import { invoke } from "@tauri-apps/api/core";

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export function defaultLocalRoot() {
  return invoke<string>("default_local_root");
}

export function parentDirectory(path: string) {
  return invoke<string | null>("parent_directory", { path });
}

export function listDirectory(path: string) {
  return invoke<FsEntry[]>("list_directory", { path });
}
