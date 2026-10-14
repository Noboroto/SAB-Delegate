'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';

/** The route's error boundary: logs the cause, shows a translated message and never `error.message`. */
export default function RouteError({
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
    <main id="main" className="page-main">
      <PageState
        status="error"
        title={t('title')}
        body={t('body')}
        action={{ label: t('retry'), onClick: reset }}
      />
    </main>
  );
}
