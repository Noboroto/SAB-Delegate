'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { ActivityForm } from './activity-form';

/** Creates the roles and channels of a new activity. */
export function ActivityTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.activity.name')} subtitle={t('tools.activity.description')} />
      <ActivityForm guildId={guildId} />
    </>
  );
}
