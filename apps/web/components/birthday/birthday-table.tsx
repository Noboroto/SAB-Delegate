'use client';

import { App, Table, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { BirthdayEntryView } from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { removeBirthday } from '@/lib/birthday/birthday-api';

interface BirthdayTableProps {
  guildId: string;
  entries: readonly BirthdayEntryView[];
  filtered: boolean;
}

const PAGE_SIZE = 10;

/**
 * The server's answer for the chosen month, a page at a time. The server has no
 * paging for this list, so the table only slices what it was handed; it never
 * filters or sorts.
 */
export function BirthdayTable({ guildId, entries, filtered }: BirthdayTableProps) {
  const t = useTranslations('web-birthday');
  const { message } = App.useApp();
  const router = useRouter();

  return (
    <Table<BirthdayEntryView>
      aria-label={t('table.label')}
      rowKey="studentId"
      dataSource={[...entries]}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: PAGE_SIZE, hideOnSinglePage: true, showSizeChanger: false }}
      locale={{ emptyText: filtered ? t('table.emptyFiltered') : t('table.empty') }}
      columns={[
        { title: t('table.name'), dataIndex: 'name' },
        { title: t('table.studentId'), dataIndex: 'studentId' },
        {
          title: t('table.discordId'),
          dataIndex: 'discordId',
          render: (id: string) => <Typography.Text code>{id}</Typography.Text>,
        },
        {
          title: t('table.birthday'),
          render: (_: unknown, entry) => `${entry.day}/${entry.month}`,
        },
        {
          title: t('table.actions'),
          render: (_: unknown, entry) => (
            <ConfirmAction
              label={t('remove.button')}
              ariaLabel={t('remove.label', { name: entry.name })}
              modalTitle={t('remove.modalTitle')}
              confirmLabel={t('remove.confirm')}
              preview={() => removeBirthday(guildId, entry.studentId, 'dryRun')}
              execute={() => removeBirthday(guildId, entry.studentId, 'confirm')}
              canConfirm={(plan) => plan.count > 0}
              renderPlan={(plan) =>
                plan.count === 0 ? (
                  <p>{t('remove.notFound')}</p>
                ) : (
                  <>
                    <p>{t('remove.plan', { count: plan.count })}</p>
                    <ul>
                      {plan.sample.map((person) => (
                        <li key={person.studentId}>
                          {person.name} ({person.studentId})
                        </li>
                      ))}
                    </ul>
                  </>
                )
              }
              onDone={(result) => {
                void message.success(t('remove.done', { count: result.count }));
                router.refresh();
              }}
            />
          ),
        },
      ]}
    />
  );
}
