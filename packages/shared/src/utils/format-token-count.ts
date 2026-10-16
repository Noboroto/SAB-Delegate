import type { Locale } from './locale.js';

// One formatter per language, built once: the bot footer, the slash replies
// and the dashboard table must group digits identically.
const FORMATTERS: Readonly<Record<Locale, Intl.NumberFormat>> = {
  vi: new Intl.NumberFormat('vi-VN'),
  en: new Intl.NumberFormat('en-US'),
};

/** A token count with the language's thousands separator: `12.345` (vi), `12,345` (en). */
export function formatTokenCount(count: number, locale: Locale): string {
  return FORMATTERS[locale].format(count);
}
