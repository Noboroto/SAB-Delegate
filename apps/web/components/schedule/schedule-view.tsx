'use client';

import { Col, Row } from 'antd';
import { useTranslations } from 'next-intl';
import { FormColumn } from '@/components/ui/form-column';
import { Heading } from '@/components/ui/heading';
import type { ScheduledRow } from '@/lib/schedule/schedule-api';
import { ScheduleCreateForm } from './schedule-create-form';
import { ScheduleTable } from './schedule-table';

/** Messages the bot sends later: schedule one, and see or cancel what is waiting. */
export function ScheduleView({ guildId, rows }: { guildId: string; rows: ScheduledRow[] }) {
  const t = useTranslations('web-schedule');

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <FormColumn>
            <ScheduleCreateForm guildId={guildId} />
          </FormColumn>
        </Col>
        <Col xs={24} xl={14}>
          <ScheduleTable guildId={guildId} rows={rows} />
        </Col>
      </Row>
    </>
  );
}
