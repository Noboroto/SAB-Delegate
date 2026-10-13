import { z } from 'zod';

/** Languages the catalog is translated into; `Guild.locale` stores one of these. */
export const LocaleSchema = z.enum(['vi', 'en']);

export type Locale = z.infer<typeof LocaleSchema>;

/** What a guild speaks until someone says otherwise. */
export const DEFAULT_LOCALE: Locale = 'vi';

/**
 * Maps a tag from Discord or a client (`vi`, `en-US`, `en-GB`, `fr`) onto a
 * catalog language by its primary subtag, or `undefined` when none matches.
 */
export function toSupportedLocale(tag: string | null | undefined): Locale | undefined {
  if (typeof tag !== 'string') return undefined;
  const primary = tag.trim().toLowerCase().split(/[-_]/, 1)[0];
  const parsed = LocaleSchema.safeParse(primary);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The first candidate the catalog covers, in the order given. An unsupported
 * tag is skipped rather than ending the search, so a French client locale
 * still falls through to the guild's preferred language.
 */
export function resolveLocale(candidates: ReadonlyArray<string | null | undefined>): Locale {
  for (const candidate of candidates) {
    const locale = toSupportedLocale(candidate);
    if (locale !== undefined) return locale;
  }
  return DEFAULT_LOCALE;
}
