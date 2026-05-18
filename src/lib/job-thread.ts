/**
 * Per-job activity log parser. Each job's thread lives at
 * `<root>/threads/<rowKey>.jsonl` — one JSON object per line.
 *
 * Read-only in v1; v3 adds append-only writes via `serializeThreadEntry`
 * + the new `local_append_text_file` Rust command. Malformed lines are
 * still dropped (with a count surfaced to the caller) so a single bad
 * line doesn't blank the panel.
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

/**
 * Serialize a `ThreadEntry` into a single JSONL line, including the
 * terminating newline. Caller appends the result to
 * `<root>/threads/<rowKey>.jsonl` via `appendTextFile` — newline-
 * terminated so the next append's content starts cleanly on a new line.
 *
 * The `JSON.stringify` output is deterministic for our shape (no
 * function/undefined values, no Date instances) so round-tripping
 * through `parseThread` is lossless.
 */
export function serializeThreadEntry(entry: ThreadEntry): string {
  return JSON.stringify(entry) + "\n";
}
