'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';

/** The bot's status could not be read (restarting, unreachable): says so under the page title and offers a reload. */
export function OverviewUnavailable() {
  const t = useTranslations('web-overview.unavailable');
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  return (
    <PageState
      status="info"
      headingLevel={2}
      title={t('title')}
      body={t('body')}
      action={{
        label: t('retry'),
        loading: refreshing,
        onClick: () => startRefresh(() => router.refresh()),
      }}
    />
  );
}
