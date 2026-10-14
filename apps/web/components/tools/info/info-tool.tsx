'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { IntroductionForm } from './introduction-form';
import { InviteForm } from './invite-form';
import { ReactorsForm } from './reactors-form';
import { RoleMembersForm } from './role-members-form';

/** Lookups: a member's introduction, who reacted, who holds a role, and an invite link. */
export function InfoTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.info.name')} subtitle={t('tools.info.description')} />
      <div style={{ display: 'grid', gap: 16 }}>
        <IntroductionForm guildId={guildId} />
        <ReactorsForm guildId={guildId} />
        <RoleMembersForm guildId={guildId} />
        <InviteForm guildId={guildId} />
      </div>
    </>
  );
}
