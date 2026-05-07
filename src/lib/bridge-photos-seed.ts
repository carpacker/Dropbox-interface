/** One-shot folder path from the web bridge, consumed by PhotosApp on next mount. */
export const BRIDGE_PHOTOS_SEED_PREFIX = "dropbox-interface:bridge-seed-path:";

export function setBridgePhotosSeed(scope: string, path: string) {
  const s = scope.trim();
  const p = path.trim();
  if (!s || !p) return;
  sessionStorage.setItem(`${BRIDGE_PHOTOS_SEED_PREFIX}${s}`, p);
}
