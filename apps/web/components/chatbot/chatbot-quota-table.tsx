'use client';

import { useState, useTransition } from 'react';
import { App, Button, Card, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  formatTokenCount,
  type ChatbotQuotaListQuery,
  type ChatbotQuotaPage,
  type ChatbotQuotaRow,
} from '@sab/shared';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { MemberSelect } from '@/components/forms/member-select';
import { ActionRow } from '@/components/ui/action-row';
import { resetChatbotUsage } from '@/lib/chatbot/chatbot-api';
import { quotaQueryString } from '@/lib/chatbot/quota-query';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { formatMonth } from '@/lib/format-datetime';
import { GrantModal, SetLimitModal } from './chatbot-quota-modals';
import { ChatbotQuotaPicker } from './chatbot-quota-picker';

type SortKey = NonNullable<ChatbotQuotaListQuery['sort']>;

interface Dialog {
  kind: 'limit' | 'grant';
  userId: string;
  row: ChatbotQuotaRow | undefined;
}

const SORTABLE: readonly SortKey[] = ['used', 'limit'];

/** This month's usage, one page at a time; paging and order live in the URL and are answered by the server. */
export function ChatbotQuotaTable({
  guildId,
  page,
  query,
}: {
  guildId: string;
  page: ChatbotQuotaPage;
  query: ChatbotQuotaListQuery;
}) {
  const t = useTranslations('web-chatbot');
  const { message } = App.useApp();
  const locale = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [dialog, setDialog] = useState<Dialog | undefined>(undefined);
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const { pagination } = page;
  const count = (value: number) => formatTokenCount(value, locale);

  const go = (next: ChatbotQuotaListQuery) =>
    startNavigation(() => router.push(`${pathname}?tab=usage&${quotaQueryString(next)}`));

  const nameOf = (row: ChatbotQuotaRow | undefined, userId: string) => row?.displayName ?? userId;
  const rowOf = (userId: string) => page.items.find((item) => item.userId === userId);

  const onTableChange: TableProps<ChatbotQuotaRow>['onChange'] = (next, _filters, sorter) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const key = SORTABLE.find((candidate) => candidate === single?.columnKey);
    // Clearing a sort falls back to the default order rather than an unsorted list.
    const sort = key ?? 'used';
    const order = key === undefined ? 'desc' : single?.order === 'ascend' ? 'asc' : 'desc';
    const sorted = sort !== query.sort || order !== query.order;
    go({
      ...query,
      sort,
      order,
      page: sorted ? 1 : (next.current ?? 1),
      pageSize: next.pageSize ?? query.pageSize,
    });
  };

  const sortOrderOf = (key: SortKey) =>
    query.sort === key
      ? query.order === 'asc'
        ? ('ascend' as const)
        : ('descend' as const)
      : null;

  const columns: TableProps<ChatbotQuotaRow>['columns'] = [
    {
      key: 'member',
      title: t('usage.columns.member'),
      fixed: 'left',
      width: 200,
      render: (_: unknown, row) => (
        <div style={{ overflowWrap: 'anywhere' }}>
          <div>{row.displayName ?? row.userId}</div>
          <Typography.Text type="secondary">
            {row.displayName === null ? t('usage.left') : row.userId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'used',
      title: t('usage.columns.used'),
      align: 'right',
      sorter: true,
      sortDirections: ['descend', 'ascend'],
      sortOrder: sortOrderOf('used'),
      render: (_: unknown, row) => count(row.used),
    },
    {
      key: 'limit',
      title: t('usage.columns.limit'),
      align: 'right',
      sorter: true,
      sortDirections: ['descend', 'ascend'],
      sortOrder: sortOrderOf('limit'),
      render: (_: unknown, row) => (
        <ActionRow style={{ justifyContent: 'flex-end' }}>
          {row.overridden ? <Tag>{t('usage.custom')}</Tag> : null}
          <span>{count(row.limit)}</span>
        </ActionRow>
      ),
    },
    {
      key: 'bonus',
      title: t('usage.columns.bonus'),
      align: 'right',
      render: (_: unknown, row) => count(row.bonus),
    },
    {
      key: 'remaining',
      title: t('usage.columns.remaining'),
      align: 'right',
      render: (_: unknown, row) => count(row.remaining),
    },
    {
      key: 'actions',
      title: t('usage.columns.actions'),
      render: (_: unknown, row) => (
        <ActionRow>
          <Button
            aria-label={t('usage.setLimitLabel', { name: nameOf(row, row.userId) })}
            onClick={() => setDialog({ kind: 'limit', userId: row.userId, row })}
          >
            {t('usage.setLimit')}
          </Button>
          <Button
            aria-label={t('usage.addTokensLabel', { name: nameOf(row, row.userId) })}
            onClick={() => setDialog({ kind: 'grant', userId: row.userId, row })}
          >
            {t('usage.addTokens')}
          </Button>
          <ConfirmAction
            label={t('usage.reset')}
            ariaLabel={t('usage.resetLabel', { name: nameOf(row, row.userId) })}
            modalTitle={t('usage.resetTitle')}
            confirmLabel={t('usage.resetConfirm')}
            preview={() => resetChatbotUsage(guildId, row.userId, true)}
            execute={() => resetChatbotUsage(guildId, row.userId, false)}
            canConfirm={(plan) => plan.used > 0}
            renderPlan={(plan) => (
              <Typography.Paragraph>
                {plan.used > 0
                  ? t('usage.resetPlan', {
                      name: nameOf(row, row.userId),
                      used: count(plan.used),
                    })
                  : t('usage.resetNothing', { name: nameOf(row, row.userId) })}
              </Typography.Paragraph>
            )}
            onDone={() => {
              void message.success(t('usage.resetDone'));
              router.refresh();
            }}
          />
        </ActionRow>
      ),
    },
  ];

  const dialogRow = dialog?.row;

  return (
    <Card title={t('usage.title', { month: formatMonth(page.period, locale) })}>
      <Typography.Paragraph type="secondary">
        {t('usage.description', { limit: count(page.defaultLimit) })}
      </Typography.Paragraph>
      <ActionRow style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <MemberSelect
            guildId={guildId}
            aria-label={t('usage.pickMember')}
            placeholder={t('usage.pickMember')}
            allowClear
            value={picked}
            onChange={setPicked}
          />
        </div>
        {picked === undefined ? (
          <>
            <Button disabled>{t('usage.setLimit')}</Button>
            <Button disabled>{t('usage.addTokens')}</Button>
          </>
        ) : (
          <ChatbotQuotaPicker
            key={picked}
            guildId={guildId}
            userId={picked}
            pageRow={rowOf(picked)}
            onOpen={(kind, row) => setDialog({ kind, userId: picked, row })}
          />
        )}
      </ActionRow>
      <Table<ChatbotQuotaRow>
        rowKey="userId"
        loading={navigating}
        dataSource={page.items}
        columns={columns}
        scroll={{ x: 'max-content' }}
        locale={{ emptyText: t('usage.empty') }}
        onChange={onTableChange}
        showSorterTooltip={false}
        pagination={{
          current: pagination.page,
          pageSize: pagination.pageSize,
          total: pagination.total,
          showSizeChanger: false,
          hideOnSinglePage: true,
        }}
      />
      {dialog?.kind === 'limit' ? (
        <SetLimitModal
          guildId={guildId}
          userId={dialog.userId}
          name={nameOf(dialogRow, dialog.userId)}
          row={dialogRow}
          defaultLimit={page.defaultLimit}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {dialog?.kind === 'grant' ? (
        <GrantModal
          guildId={guildId}
          userId={dialog.userId}
          name={nameOf(dialogRow, dialog.userId)}
          row={dialogRow}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
    </Card>
  );
}
