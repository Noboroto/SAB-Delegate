import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { BUSINESS_TIME_ZONE } from '@sab/shared';
import { webMessages } from '@/lib/web-messages';
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  type SupportedLocale,
} from '@/lib/locale';

/** The language was settled by `proxy.ts`; this only reads it back. */
export async function resolveLocale(): Promise<SupportedLocale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isSupportedLocale(stored) ? stored : DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return { locale, messages: webMessages(locale), timeZone: BUSINESS_TIME_ZONE };
});
