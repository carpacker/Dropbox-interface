/**
 * Per-row key derivation for the CRM.
 *
 * The row key drives:
 *   - the React list key in the table
 *   - the filename of the pertinent-files sidebar (`<root>/files/<key>/`)
 *
 * Lookup order:
 *   1. case-insensitive `id` column
 *   2. case-insensitive `name` column
 *   3. first declared column
 *
 * Keys are sanitized so they're safe-ish to use as filesystem path
 * components (the user controls the CSV, but typos shouldn't blow up).
 * Reject empties so a malformed row doesn't collide with another at
 * an empty key.
 */

import type { CsvRow } from "./csv";

const KEY_COLUMN_PREFERENCES = ["id", "name"];

/**
 * Pick which column to use as the row key, given the header list. The
 * choice is stable for the lifetime of a parsed CSV.
 */
export function pickKeyColumn(headers: string[]): string | null {
  if (headers.length === 0) return null;
  const byLower = new Map<string, string>();
  for (const h of headers) byLower.set(h.toLowerCase(), h);
  for (const pref of KEY_COLUMN_PREFERENCES) {
    const got = byLower.get(pref);
    if (got !== undefined) return got;
  }
  return headers[0];
}

/**
 * Return a row key, or null when the row's chosen column is missing
 * or empty after sanitization.
 */
export function rowKeyFor(row: CsvRow, keyColumn: string): string | null {
  const raw = row[keyColumn];
  if (raw === undefined) return null;
  const sanitized = sanitizeKey(raw);
  return sanitized === "" ? null : sanitized;
}

/**
 * Replace path separators and other filesystem-unfriendly characters
 * with `_`. Collapses runs of `_` and trims leading/trailing ones.
 *
 *   "Doe, Jane / Acme"  →  "Doe_Jane_Acme"
 *   "  ../etc "         →  "etc"
 *
 * Order matters:
 *   1. trim leading/trailing whitespace
 *   2. collapse dot-runs (path-traversal sequences) to `_`
 *   3. collapse runs of {whitespace, path separator, common
 *      filesystem-unsafe chars, hyphen} to `_`
 *   4. collapse adjacent underscores
 *   5. trim leading/trailing underscores
 */
export function sanitizeKey(raw: string): string {
  const unsafe = new RegExp("[\\s/\\\\:*?\"<>|-]+", "g");
  return raw
    .trim()
    .replace(/\.+/g, "_")
    .replace(unsafe, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}
