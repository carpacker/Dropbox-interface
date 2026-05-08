/**
 * Human-friendly relative time formatting. Pure helper. Used by the
 * dashboard recents card and the file/listing rows.
 *
 * Accepts either unix-millisecond numbers (App.tsx's existing call
 * site) or ISO-8601 strings (Dropbox's `server_modified`). Garbage
 * inputs return an empty string so callers can render `{value}` raw
 * without conditional logic.
 */

/**
 * "5m ago" / "2h ago" / "3d ago"-style relative timestamp.
 *
 * `value` may be:
 *  - unix milliseconds (number)
 *  - ISO-8601 string (Dropbox `server_modified`)
 *
 * `now` is unix milliseconds.
 */
export function formatRelativeTime(
  value: number | string | null | undefined,
  now: number,
): string {
  const ms = toMillis(value);
  if (ms === null) return "";
  const delta = Math.max(0, now - ms);
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  return `${Math.floor(month / 12)}y ago`;
}

function toMillis(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const parsed = Date.parse(v);
  return Number.isNaN(parsed) ? null : parsed;
}
