'use client';

import { Segmented } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  type SupportedLocale,
} from '@/lib/locale';

export function LangSwitcher() {
  const t = useTranslations('web.language');
  const router = useRouter();
  const current = useLocale();

  const change = (next: SupportedLocale) => {
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    // Server components render the messages, so they must run again.
    router.refresh();
  };

  return (
    <Segmented<SupportedLocale>
      aria-label={t('label')}
      value={isSupportedLocale(current) ? current : 'vi'}
      onChange={change}
      options={SUPPORTED_LOCALES.map((locale) => ({
        value: locale,
        label: locale.toUpperCase(),
        title: t(locale),
      }))}
    />
  );
}
