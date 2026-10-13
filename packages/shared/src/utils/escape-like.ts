/**
 * Makes text safe to put inside a `LIKE`/`ILIKE` pattern. Prisma's `contains`
 * wraps the value in `%…%` without escaping it, so a typed `%` or `_` would
 * match everything. Backslash is Postgres's default escape character and goes
 * first so the escapes added after it are not doubled.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
