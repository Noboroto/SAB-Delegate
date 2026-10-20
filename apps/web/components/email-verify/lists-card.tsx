'use client';

import { useState } from 'react';
import { App, Button, Card, Input, Popconfirm, Table, Typography } from 'antd';
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
  const remove = useApiMutation((listId: string) => deleteEmailList(guildId, listId));

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

  const onDelete = async (listId: string) => {
    const outcome = await remove.run(listId);
    if (outcome?.ok !== true) return;
    void message.success(t('deleted'));
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
        <Popconfirm
          title={t('deleteConfirm', { name: row.name })}
          okText={t('delete')}
          okButtonProps={{ danger: true }}
          onConfirm={() => void onDelete(row.id)}
        >
          <Button
            danger
            aria-label={t('deleteLabel', { name: row.name })}
            disabled={remove.pending}
          >
            {t('delete')}
          </Button>
        </Popconfirm>
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
              style={{ flex: '1 1 220px', width: 'auto', minWidth: 0 }}
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
        {create.error === undefined && remove.error === undefined ? null : (
          <ErrorAlert error={create.error ?? remove.error} />
        )}
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
