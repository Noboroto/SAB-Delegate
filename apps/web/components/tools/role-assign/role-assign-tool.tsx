'use client';

import { useTranslations } from 'next-intl';
import { Heading } from '@/components/ui/heading';
import { RoleAssignMembersForm } from './role-assign-members-form';
import { RoleAssignReactorsForm } from './role-assign-reactors-form';

/** Bulk role changes: by a list of members, or by who reacted to a message. */
export function RoleAssignTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.roleAssign.name')} subtitle={t('tools.roleAssign.description')} />
      <div style={{ display: 'grid', gap: 16 }}>
        <RoleAssignMembersForm guildId={guildId} />
        <RoleAssignReactorsForm guildId={guildId} />
      </div>
    </>
  );
}
