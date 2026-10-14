'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';

/** What a route's error boundary shows: logs the cause, then a translated message, never `error.message`. */
export function RouteErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('web.errorPage');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageState
      status="error"
      title={t('title')}
      body={t('body')}
      action={{ label: t('retry'), onClick: reset }}
    />
  );
}
