'use client';

import { useMemo } from 'react';
import { App, Card, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ScheduleCancelResult } from '@sab/shared';
import { DiscordTimestamp } from '@/components/data/discord-timestamp';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { useChannels } from '@/lib/discord/use-channels';
import { cancelSchedule, type ScheduledRow } from '@/lib/schedule/schedule-api';

const PAGE_SIZE = 10;

/** The messages waiting to go out, with the way to cancel each. */
export function ScheduleTable({ guildId, rows }: { guildId: string; rows: ScheduledRow[] }) {
  const t = useTranslations('web-schedule');
  const { message } = App.useApp();
  const router = useRouter();
  const channels = useChannels(guildId);
  const channelNames = useMemo(
    () => new Map((channels.data ?? []).map((channel) => [channel.id, channel.name])),
    [channels.data],
  );

  const planText = (plan: ScheduleCancelResult): string => {
    switch (plan.code) {
      case 'CANCELED':
        return t('cancel.planCanceled', { seq: plan.seq });
      case 'ALREADY_CANCELED':
        return t('cancel.planAlready', { seq: plan.seq });
      case 'NOT_PENDING':
        return t('cancel.planNotPending', { seq: plan.seq });
      case 'NOT_FOUND':
        return t('cancel.planNotFound', { seq: plan.seq });
    }
  };

  return (
    <Card title={t('table.title', { count: rows.length })}>
      <Table<ScheduledRow>
        rowKey="id"
        size="small"
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('table.empty') }}
        pagination={{ pageSize: PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false }}
        columns={[
          { key: 'seq', title: t('table.number'), dataIndex: 'seq', width: 72 },
          {
            key: 'runAt',
            title: t('table.when'),
            render: (_, row) => <DiscordTimestamp value={row.runAt} />,
          },
          {
            key: 'channel',
            title: t('table.channel'),
            render: (_, row) => {
              const name = channelNames.get(row.channelId);
              return name === undefined ? row.channelId : `# ${name}`;
            },
          },
          {
            key: 'what',
            title: t('table.what'),
            render: (_, row) => (
              <div style={{ maxWidth: 360 }}>
                <Tag>{row.kind === 'COPY' ? t('table.kindCopy') : t('table.kindSend')}</Tag>
                <Typography.Text ellipsis={{ tooltip: true }}>
                  {row.kind === 'COPY'
                    ? t('table.copyOf', {
                        source: `${row.sourceChannelId ?? '?'}/${row.sourceMessageId ?? '?'}`,
                      })
                    : (row.content ?? '')}
                </Typography.Text>
              </div>
            ),
          },
          {
            key: 'actions',
            title: t('table.actions'),
            render: (_, row) => (
              <ConfirmAction
                label={t('cancel.action', { seq: row.seq })}
                modalTitle={t('cancel.modalTitle', { seq: row.seq })}
                confirmLabel={t('cancel.confirm')}
                canConfirm={(plan) => plan.code === 'CANCELED'}
                preview={() => cancelSchedule(guildId, row.seq, true)}
                execute={() => cancelSchedule(guildId, row.seq, false)}
                renderPlan={(plan: ScheduleCancelResult) => (
                  <Typography.Paragraph>{planText(plan)}</Typography.Paragraph>
                )}
                onDone={() => {
                  void message.success(t('cancel.done', { seq: row.seq }));
                  router.refresh();
                }}
              />
            ),
          },
        ]}
      />
    </Card>
  );
}
