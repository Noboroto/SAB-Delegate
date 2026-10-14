import type { Locale } from '@sab/shared';

/**
 * `satisfies` ties this list to the language set the shared catalog is
 * translated into: adding a language there fails the typecheck here until the
 * switcher and the request config know it too. Type-only import on purpose:
 * this module is read by client components and by `proxy.ts`, and a value
 * import would pull the whole shared package (Zod, every catalog) with it.
 */
export const SUPPORTED_LOCALES = ['vi', 'en'] as const satisfies readonly Locale[];

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Vietnamese until the visitor picks otherwise; never guessed from `accept-language`. */
export const DEFAULT_LOCALE: SupportedLocale = 'vi';

export const LOCALE_COOKIE = 'locale';

/** One year, the longest a language choice is worth remembering. */
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

export function isSupportedLocale(value: string | undefined): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value ?? '');
}
