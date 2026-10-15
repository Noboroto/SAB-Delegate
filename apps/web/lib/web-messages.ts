import { MESSAGES } from '@sab/shared';
import type { SupportedLocale } from '@/lib/locale';

/**
 * The catalog namespaces the web app reads. The catalog is shared with the bot,
 * and `NextIntlClientProvider` ships whatever it is handed to the browser, so
 * the bot's own strings (command descriptions, replies) are left out. `errors`
 * holds the translation of every server `ErrorCode`.
 */
export const WEB_NAMESPACES = [
  'web',
  'login',
  'servers',
  'errors',
  'web-common',
  'web-overview',
  'web-settings',
  'web-birthday',
  'web-note',
  'web-word-game',
  // The game rules and names, shared with the bot's `/help`.
  'mini-game',
  'web-messaging',
  'web-schedule',
  'web-tools',
  'web-commands',
  'web-audit-log',
  'web-api-keys',
] as const;

export function webMessages(locale: SupportedLocale) {
  const catalog = MESSAGES[locale];
  return Object.fromEntries(WEB_NAMESPACES.map((namespace) => [namespace, catalog[namespace]]));
}
