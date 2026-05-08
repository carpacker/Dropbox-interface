/**
 * Per-listing text filter. Pure helpers — no React, no Tauri.
 *
 * Filters apply *after* sort and *before* render. Currently a simple
 * case-insensitive substring match against the entry's `name`. Empty
 * query is the no-op (returns the input array verbatim).
 *
 * Filters are deliberately NOT persisted. Sort is global; filter is
 * ephemeral (the user types into a chip per-listing).
 */

const SEPARATOR = /\s+/;

/**
 * `query` matches `name` if every whitespace-separated token in
 * `query` is a case-insensitive substring of `name`. So
 * `matchesQuery("hero shot", "Hero Shot Final.png")` → true. This
 * makes searches like "mp4 final" feel natural without committing to
 * a more expensive scoring algorithm.
 */
export function matchesQuery(name: string, query: string): boolean {
  const q = query.trim();
  if (q === "") return true;
  const haystack = name.toLowerCase();
  const tokens = q.toLowerCase().split(SEPARATOR);
  return tokens.every((t) => haystack.includes(t));
}

/**
 * Filter an array of entries by query. Returns a new array;
 * preserves input order. Empty query short-circuits to identity (and
 * returns the same reference) so callers don't pay for a copy when
 * the chip is empty.
 */
export function filterByQuery<T extends { name: string }>(
  entries: ReadonlyArray<T>,
  query: string,
): T[] | ReadonlyArray<T> {
  if (query.trim() === "") return entries;
  return entries.filter((e) => matchesQuery(e.name, query));
}
