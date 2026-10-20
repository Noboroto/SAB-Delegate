import { EMAIL_ADDRESS_MAX } from '@sab/shared';

export interface ParsedEmails {
  /** Distinct (case-insensitive) pieces of text that contain an `@` and can fit an address. */
  emails: string[];
  /** Pieces of text that cannot be an address (a CSV header, a name, text longer than an address). */
  ignored: number;
}

/**
 * Addresses from pasted text or the text of a CSV/TXT file: separated by white
 * space, commas, semicolons or `|`, optionally quoted. The server validates and
 * normalises; this only keeps what could be an address, once each, so a header
 * row, a column of names or a run of text too long to be an address does not
 * fill a request.
 */
export function parseEmailText(text: string): ParsedEmails {
  const seen = new Set<string>();
  const emails: string[] = [];
  let ignored = 0;
  for (const piece of text.split(/[\s,;|]+/)) {
    const token = piece.replace(/^["'<(]+|["'>)]+$/g, '');
    if (token === '') continue;
    if (!token.includes('@') || token.length > EMAIL_ADDRESS_MAX) {
      ignored += 1;
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(token);
  }
  return { emails, ignored };
}

/** Splits a list into runs of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const runs: T[][] = [];
  for (let i = 0; i < items.length; i += size) runs.push(items.slice(i, i + size));
  return runs;
}
