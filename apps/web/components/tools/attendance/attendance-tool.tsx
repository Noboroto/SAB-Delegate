'use client';

import { useTranslations } from 'next-intl';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import { AttendanceForm } from './attendance-form';

/** Roll call: who of a role is in a voice channel. */
export function AttendanceTool({ guildId }: { guildId: string }) {
  const t = useTranslations('web-tools');

  return (
    <>
      <Heading title={t('tools.attendance.name')} subtitle={t('tools.attendance.description')} />
      <FormColumn>
        <AttendanceForm guildId={guildId} />
      </FormColumn>
    </>
  );
}
