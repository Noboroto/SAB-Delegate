'use client';

import { useLocale } from 'next-intl';
import { formatDateTime } from '@/lib/format-datetime';
import { isSupportedLocale, DEFAULT_LOCALE } from '@/lib/locale';

/**
 * A moment as wall-clock time in the business time zone, whatever zone the
 * viewer's machine is in. The machine-readable instant stays in `dateTime`.
 */
export function DiscordTimestamp({ value }: { value: Date | string | number }) {
  const current = useLocale();
  const locale = isSupportedLocale(current) ? current : DEFAULT_LOCALE;
  const instant = new Date(value);

  return <time dateTime={instant.toISOString()}>{formatDateTime(instant, locale)}</time>;
}
