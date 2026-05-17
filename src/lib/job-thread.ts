/**
 * Per-job activity log parser. Each job's thread lives at
 * `<root>/threads/<rowKey>.jsonl` — one JSON object per line.
 *
 * Read-only for v1. Malformed lines are dropped (with a count
 * surfaced to the caller) so a single bad line doesn't blank the
 * panel. Writes (proper append handling, atomic rotation when the
 * file approaches the cap) come in the next round.
 */

export type ThreadEntryKind = "note" | "email-link";

export type ThreadEntry = {
  /** ISO 8601 timestamp. */
  at: string;
  /** Author/handle. Free-form (no auth model in this app). */
  by: string;
  kind: ThreadEntryKind;
  /**
   * Free-form body for notes; for `email-link`, expected to be a
   * displayable label (the URL/path itself can be derived later when
   * we add navigation).
   */
  body: string;
};

export type ThreadParseResult = {
  /** Successfully parsed entries, in source-file order. */
  entries: ThreadEntry[];
  /** Number of lines that failed validation (non-blank but unparseable). */
  skipped: number;
};

function isEntryKind(v: unknown): v is ThreadEntryKind {
  return v === "note" || v === "email-link";
}

function isEntry(v: unknown): v is ThreadEntry {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.at === "string" &&
    typeof o.by === "string" &&
    isEntryKind(o.kind) &&
    typeof o.body === "string"
  );
}

/**
 * Parse a JSONL thread file. Blank lines are skipped without
 * counting against `skipped`. Lines that are non-blank but fail
 * `JSON.parse` or schema validation are counted.
 */
export function parseThread(input: string): ThreadParseResult {
  const entries: ThreadEntry[] = [];
  let skipped = 0;
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "") continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEntry(parsed)) {
        entries.push(parsed);
      } else {
        skipped += 1;
      }
    } catch {
      skipped += 1;
    }
  }
  return { entries, skipped };
}
