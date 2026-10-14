import { MESSAGES } from '@sab/shared';
import type { SupportedLocale } from '@/lib/locale';

/**
 * The catalog namespaces the web app reads. The catalog is shared with the bot,
 * and `NextIntlClientProvider` ships whatever it is handed to the browser, so
 * the bot's own strings (command descriptions, replies) are left out. `errors`
 * holds the translation of every server `ErrorCode`.
 */
export const WEB_NAMESPACES = ['web', 'errors'] as const;

export function webMessages(locale: SupportedLocale) {
  const catalog = MESSAGES[locale];
  return Object.fromEntries(WEB_NAMESPACES.map((namespace) => [namespace, catalog[namespace]]));
}
