'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';

/** Placeholder for a dashboard page whose feature has not shipped: names the page, says it is coming. */
export function SectionStub({ title }: { title: string }) {
  const t = useTranslations('servers.nav');

  return <Heading title={title} subtitle={t('comingSoon')} />;
}
