import { convertFileSrc, invoke } from "@tauri-apps/api/core";

export type FsEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export const IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".bmp",
] as const;

export function isImageFile(path: string): boolean {
  const lowered = path.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

export function defaultLocalRoot() {
  return invoke<string>("default_local_root");
}

export function parentDirectory(path: string) {
  return invoke<string | null>("parent_directory", { path });
}

export function listDirectory(path: string) {
  return invoke<FsEntry[]>("list_directory", { path });
}

/**
 * Convert a local filesystem path into a URL the webview can load via the
 * Tauri asset protocol. Streams the file directly into <img>/<video>/etc
 * without round-tripping through JS memory like a base64 data URL would.
 */
export function imageSrc(path: string): string {
  return convertFileSrc(path);
}
