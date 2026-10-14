import { createTranslator } from 'next-intl';
import { webMessages } from '@/lib/web-messages';
import type { SupportedLocale } from '@/lib/locale';

/**
 * Stands in for `getTranslations` from `next-intl/server` with a real
 * translator over the real catalog, so a server component test reads the
 * translated text, not a key.
 */
export function serverTranslations(locale: SupportedLocale = 'vi') {
  return (namespace: string) =>
    Promise.resolve(createTranslator({ locale, messages: webMessages(locale), namespace }));
}
