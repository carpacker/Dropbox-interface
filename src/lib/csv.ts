/**
 * Minimal CSV parser. Handles the cases an internal-tool CRM CSV needs:
 *
 *   - Header row → field names.
 *   - Quoted fields with embedded commas, newlines, and escaped
 *     double-quotes (`""`).
 *   - Trailing newline (with or without).
 *   - `\r\n` and `\n` line endings (no naked `\r` support; very rare
 *     in modern exports and easy to add later if needed).
 *
 * Deliberately not handling: BOM-stripping (callers can `.replace`
 * the leading U+FEFF), alternative delimiters (semicolon/tab),
 * comment lines. This stays a CSV — not a general DSV — until a real
 * workflow demands more.
 */

export type CsvRow = Record<string, string>;

export type CsvParseError = {
  /** 1-based line where the issue was detected. */
  line: number;
  message: string;
};

export type CsvParseResult =
  | { ok: true; headers: string[]; rows: CsvRow[] }
  | { ok: false; errors: CsvParseError[] };

/**
 * Parse a CSV string. Returns headers + rows on success, or a list of
 * structured errors on failure. The first non-empty line is treated as
 * the header row; subsequent rows are zipped into objects keyed by
 * header name.
 *
 * Behavior on shape mismatches:
 *   - Too few columns → missing keys are filled with "" (so a row
 *     can omit trailing optional fields).
 *   - Too many columns → extras are dropped silently. Future: surface
 *     as a warning the UI can display.
 */
export function parseCsv(input: string): CsvParseResult {
  const errors: CsvParseError[] = [];
  const records = tokenize(input, errors);
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  if (records.length === 0) {
    return { ok: false, errors: [{ line: 1, message: "CSV is empty." }] };
  }
  const headers = records[0];
  if (headers.length === 0 || headers.every((h) => h === "")) {
    return {
      ok: false,
      errors: [{ line: 1, message: "Header row has no columns." }],
    };
  }
  // Detect duplicate header names — would clobber row values silently.
  const seen = new Set<string>();
  for (const h of headers) {
    if (seen.has(h)) {
      return {
        ok: false,
        errors: [
          {
            line: 1,
            message: `Duplicate header column ${JSON.stringify(h)}.`,
          },
        ],
      };
    }
    seen.add(h);
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const cells = records[i];
    // Skip blank lines (a single empty cell on a row by itself).
    if (cells.length === 1 && cells[0] === "") continue;
    const row: CsvRow = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = cells[c] ?? "";
    }
    rows.push(row);
  }
  return { ok: true, headers, rows };
}

/**
 * Tokenize CSV text into a `string[][]` (records of fields). Errors
 * (unterminated quoted fields) are appended to `errors`.
 */
function tokenize(input: string, errors: CsvParseError[]): string[][] {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let i = 0;
  let line = 1;
  let inQuotes = false;
  let quoteStartLine = 0;

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        // Escaped quote: `""` inside a quoted field → literal `"`.
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        // Closing quote.
        inQuotes = false;
        i++;
        continue;
      }
      if (ch === "\n") line++;
      field += ch;
      i++;
      continue;
    }

    // Not in quotes.
    if (ch === '"') {
      // Quoted field MUST start at the beginning of a field; treat a
      // mid-field quote as a literal so weirdly-formatted exports
      // don't completely fail. (Strict mode is a follow-up.)
      if (field === "") {
        inQuotes = true;
        quoteStartLine = line;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      // Consume CRLF as a single newline.
      if (input[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      line++;
      i++;
      continue;
    }
    if (ch === "\n") {
      row.push(field);
      records.push(row);
      row = [];
      field = "";
      line++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) {
    errors.push({
      line: quoteStartLine,
      message: "Unterminated quoted field.",
    });
    return [];
  }

  // Flush the final field/record if the input didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    records.push(row);
  }
  return records;
}
