'use client';

import { useState } from 'react';
import { App, Button, Card, Input, Table, Typography } from 'antd';
import type { TableProps } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  EMAIL_LISTS_MAX,
  EMAIL_LIST_ENTRIES_MAX,
  EmailListNameSchema,
  type EmailListSummary,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { ActionRow } from '@/components/ui/action-row';
import { useApiMutation } from '@/lib/api/mutations';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { createEmailList, deleteEmailList } from '@/lib/email-verify/email-verify-api';
import { formatDateTime } from '@/lib/format-datetime';
import { ListEntriesPanel } from './list-entries-panel';

/** The server's named email lists: create or delete one, and fill one from text or a file. */
export function ListsCard({ guildId, lists }: { guildId: string; lists: EmailListSummary[] }) {
  const t = useTranslations('web-email-verify.lists');
  const { message } = App.useApp();
  const locale = useUiLocale();
  const router = useRouter();
  const [name, setName] = useState('');
  const create = useApiMutation((listName: string) => createEmailList(guildId, { name: listName }));

  const parsedName = EmailListNameSchema.safeParse(name);
  const full = lists.length >= EMAIL_LISTS_MAX;
  const nameInvalid = name.trim() !== '' && !parsedName.success;

  const onCreate = async () => {
    if (!parsedName.success) return;
    const outcome = await create.run(parsedName.data);
    if (outcome?.ok !== true) return;
    setName('');
    void message.success(t('created'));
    router.refresh();
  };

  const columns: TableProps<EmailListSummary>['columns'] = [
    {
      key: 'name',
      title: t('name'),
      dataIndex: 'name',
      render: (value: string) => <code>{value}</code>,
    },
    { key: 'entryCount', title: t('entryCount'), dataIndex: 'entryCount', align: 'right' },
    {
      key: 'createdAt',
      title: t('createdAt'),
      render: (_: unknown, row) => formatDateTime(row.createdAt, locale),
    },
    {
      key: 'actions',
      title: t('actions'),
      render: (_: unknown, row) => (
        <ConfirmAction
          label={t('delete')}
          ariaLabel={t('deleteLabel', { name: row.name })}
          modalTitle={t('deleteTitle')}
          confirmLabel={t('delete')}
          // The service has no dry run for a list; the plan is what the row already says.
          preview={() => Promise.resolve(row)}
          execute={() => deleteEmailList(guildId, row.id)}
          renderPlan={(plan) => (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('deleteConfirm', { name: plan.name })}
            </Typography.Paragraph>
          )}
          onDone={() => {
            void message.success(t('deleted'));
            router.refresh();
          }}
        />
      ),
    },
  ];

  return (
    <Card title={t('title')}>
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <Typography.Text type="secondary">{t('intro')}</Typography.Text>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onCreate();
          }}
          style={{ display: 'grid', gap: 'var(--space-1)' }}
        >
          <label htmlFor="ev-list-name">{t('name')}</label>
          <ActionRow>
            <Input
              id="ev-list-name"
              value={name}
              maxLength={32}
              autoComplete="off"
              disabled={full || create.pending}
              status={nameInvalid ? 'error' : undefined}
              aria-invalid={nameInvalid}
              onChange={(event) => {
                create.reset();
                setName(event.target.value);
              }}
              style={{ flex: '1 1 var(--w-sm)', width: 'auto', minWidth: 0 }}
            />
            <Button
              type="primary"
              htmlType="submit"
              loading={create.pending}
              disabled={full || !parsedName.success}
            >
              {t('create')}
            </Button>
          </ActionRow>
          <Typography.Text type={nameInvalid ? 'danger' : 'secondary'}>
            {full ? t('full', { max: EMAIL_LISTS_MAX }) : t('nameHelp')}
          </Typography.Text>
        </form>
        {create.error === undefined ? null : <ErrorAlert error={create.error} />}
        <Table<EmailListSummary>
          rowKey="id"
          dataSource={lists}
          columns={columns}
          pagination={false}
          scroll={{ x: 'max-content' }}
          locale={{ emptyText: t('empty') }}
          expandable={{
            expandedRowRender: (row) => <ListEntriesPanel guildId={guildId} list={row} />,
          }}
        />
        <Typography.Text type="secondary">
          {t('entriesFull', { max: EMAIL_LIST_ENTRIES_MAX })}
        </Typography.Text>
      </div>
    </Card>
  );
}
