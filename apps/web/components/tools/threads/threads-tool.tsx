'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { CreateThreadForm } from './create-thread-form';
import { DeleteThreadsForm } from './delete-threads-form';
import { PrivateReactorsThreadsForm } from './private-reactors-threads-form';
import { PrivateThreadsForm } from './private-threads-form';
import { RenameThreadsForm } from './rename-threads-form';

/** Threads: open one, open private ones for members, and rename or delete many by prefix. */
export function ThreadsTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.threads.name')} subtitle={t('tools.threads.description')} />
      <div style={{ display: 'grid', gap: 16 }}>
        <CreateThreadForm guildId={guildId} />
        <PrivateThreadsForm guildId={guildId} />
        <PrivateReactorsThreadsForm guildId={guildId} />
        <RenameThreadsForm guildId={guildId} />
        <DeleteThreadsForm guildId={guildId} />
      </div>
    </>
  );
}
