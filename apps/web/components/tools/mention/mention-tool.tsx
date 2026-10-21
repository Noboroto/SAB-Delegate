'use client';

import { useTranslations } from 'next-intl';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { MentionNonReactorsForm } from './mention-non-reactors-form';
import { MentionReactorsForm } from './mention-reactors-form';

/** Mention lists by reaction: who reacted, and who did not. */
export function MentionTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.mention.name')} subtitle={t('tools.mention.description')} />
      <FormColumn>
        <MentionReactorsForm guildId={guildId} />
        <MentionNonReactorsForm guildId={guildId} />
      </FormColumn>
    </>
  );
}
