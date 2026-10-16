'use client';

import { useLocale } from 'next-intl';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '@/lib/locale';

/** The page language, for the formatters that take one (`formatTokenCount`, `formatDateTime`). */
export function useUiLocale(): SupportedLocale {
  const current = useLocale();
  return isSupportedLocale(current) ? current : DEFAULT_LOCALE;
}
