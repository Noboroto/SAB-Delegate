'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { PurgeForm } from './purge-form';

/** Bulk message deletion in one channel. */
export function PurgeTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.purge.name')} subtitle={t('tools.purge.description')} />
      <PurgeForm guildId={guildId} />
    </>
  );
}
