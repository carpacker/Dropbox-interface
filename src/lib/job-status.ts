/**
 * Status-column derivation for the Job Tracker board view.
 *
 * Looks for a column literally named `status` (case-insensitive),
 * falling back to a single bucket called "Backlog" when none exists
 * — so a CSV without a status column still renders as a one-column
 * board instead of crashing.
 *
 * Distinct status values are collected from the rows themselves
 * (auto-derived). A future round may let the user declare an
 * ordered status list in a sidecar config so empty statuses still
 * render a column. v1: only values that have at least one row.
 */

import type { CsvRow } from "./csv";

/** Synthetic status used when no status column is present. */
export const FALLBACK_STATUS = "Backlog";

/**
 * Pick the column to group rows by. Returns the header name when a
 * `status` column exists, or null to signal "no column — use the
 * fallback bucket".
 */
export function pickStatusColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (h.trim().toLowerCase() === "status") return h;
  }
  return null;
}

/**
 * Collect the distinct, non-empty status values present in `rows`,
 * preserving the order they're first seen. Empty / whitespace-only
 * cells get folded into the fallback bucket so a row missing its
 * status isn't dropped from the board.
 */
export function deriveStatusValues(
  rows: CsvRow[],
  statusColumn: string | null,
): string[] {
  if (!statusColumn) return [FALLBACK_STATUS];
  const seen: string[] = [];
  let sawEmpty = false;
  for (const row of rows) {
    const raw = row[statusColumn] ?? "";
    const v = raw.trim();
    if (v === "") {
      sawEmpty = true;
      continue;
    }
    if (!seen.includes(v)) seen.push(v);
  }
  // If any row lacked a status, surface the fallback bucket at the
  // *end* so it doesn't crowd the declared statuses.
  if (sawEmpty) seen.push(FALLBACK_STATUS);
  // Always return at least the fallback so the board renders even
  // for an empty CSV.
  return seen.length > 0 ? seen : [FALLBACK_STATUS];
}

/**
 * Bucket a row's status value to a column. Empty / whitespace cells
 * (or rows in a CSV without a status column) land in `FALLBACK_STATUS`.
 */
export function statusOf(
  row: CsvRow,
  statusColumn: string | null,
): string {
  if (!statusColumn) return FALLBACK_STATUS;
  const v = (row[statusColumn] ?? "").trim();
  return v === "" ? FALLBACK_STATUS : v;
}
