'use client';

import { Spin } from 'antd';
import { useTranslations } from 'next-intl';

/** What a page shows while its data loads: centred spinner, no layout shift, announced to screen readers. */
export function PageLoading() {
  const t = useTranslations('web');

  return (
    <div
      role="status"
      aria-label={t('loading')}
      style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}
    >
      <Spin size="large" />
    </div>
  );
}
