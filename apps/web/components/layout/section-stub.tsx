'use client';

import { Typography } from 'antd';
import { useTranslations } from 'next-intl';

/** Placeholder for a dashboard page whose feature has not shipped: names the page, says it is coming. */
export function SectionStub({ title }: { title: string }) {
  const t = useTranslations('servers.nav');

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0, overflowWrap: 'anywhere' }}>
        {title}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t('comingSoon')}</Typography.Paragraph>
    </>
  );
}
