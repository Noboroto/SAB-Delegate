'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PageState } from '@/components/ui/page-state';

/**
 * No server to manage yet. The permission may have just been granted in Discord,
 * so the next step is reading the list again.
 */
export function ServersEmpty() {
  const t = useTranslations('servers.empty');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <PageState
      status="info"
      headingLevel={2}
      title={t('title')}
      body={t('body')}
      action={{
        label: t('reload'),
        loading: pending,
        onClick: () => startTransition(() => router.refresh()),
      }}
    />
  );
}
