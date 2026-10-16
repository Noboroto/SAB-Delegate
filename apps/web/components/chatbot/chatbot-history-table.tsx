'use client';

import { useState, useTransition } from 'react';
import { Button, Card, Input, Select, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CHATBOT_HISTORY_RETENTION_DAYS,
  ChatbotTurnRowSchema,
  formatTokenCount,
  type ChatbotTurnListQuery,
  type ChatbotTurnPage,
  type ChatbotTurnRow,
} from '@sab/shared';
import { DiscordTimestamp } from '@/components/data/discord-timestamp';
import { ChannelSelect } from '@/components/forms/channel-select';
import { MemberSelect } from '@/components/forms/member-select';
import { ActionRow } from '@/components/ui/action-row';
import { dayEndIso, dayOf, dayStartIso } from '@/lib/chatbot/day-range';
import { hasTurnFilter, turnsQueryString } from '@/lib/chatbot/turns-query';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { TEXT_CHANNEL_TYPES, useChannels } from '@/lib/discord/use-channels';
import { ChatbotTurnDelete } from './chatbot-turn-delete';
import { ChatbotTurnDrawer } from './chatbot-turn-drawer';

type Status = ChatbotTurnRow['status'];
type Row = ChatbotTurnPage['items'][number];

const STATUSES = ChatbotTurnRowSchema.shape.status.options;

const STATUS_COLOR: Record<Status, string> = {
  OK: 'success',
  QUOTA_EXHAUSTED: 'warning',
  NOT_CONFIGURED: 'default',
  FAILED: 'error',
  PENDING: 'processing',
  EXPIRED: 'default',
};

const CLAMP = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
} as const;

/** The exchanges the bot logged. Filters, order and paging live in the URL and are answered by the server. */
export function ChatbotHistoryTable({
  guildId,
  page,
  query,
}: {
  guildId: string;
  page: ChatbotTurnPage;
  query: ChatbotTurnListQuery;
}) {
  const t = useTranslations('web-chatbot');
  const tLlm = useTranslations('web-settings');
  const locale = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const known = useChannels(guildId);
  const [navigating, startNavigation] = useTransition();
  const [openId, setOpenId] = useState<string | undefined>(undefined);
  const { pagination } = page;
  const count = (value: number) => formatTokenCount(value, locale);

  const go = (next: ChatbotTurnListQuery) =>
    startNavigation(() => router.push(`${pathname}?tab=history&${turnsQueryString(next)}`));

  // A new filter starts from the first page: the old page number belongs to the old result.
  const filter = (change: Partial<ChatbotTurnListQuery>) => go({ ...query, ...change, page: 1 });

  const channelName = (channelId: string): string => {
    const name = known.data?.find((channel) => channel.id === channelId)?.name;
    return name === undefined ? channelId : `# ${name}`;
  };

  const statusLabels: Record<Status, string> = {
    OK: t('history.status.OK'),
    QUOTA_EXHAUSTED: t('history.status.QUOTA_EXHAUSTED'),
    NOT_CONFIGURED: t('history.status.NOT_CONFIGURED'),
    FAILED: t('history.status.FAILED'),
    PENDING: t('history.status.PENDING'),
    EXPIRED: t('history.status.EXPIRED'),
  };

  const onTableChange: TableProps<Row>['onChange'] = (next, _filters, sorter) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const order = single?.order === 'ascend' ? 'asc' : 'desc';
    go({
      ...query,
      order,
      page: order === query.order ? (next.current ?? 1) : 1,
    });
  };

  const columns: TableProps<Row>['columns'] = [
    {
      key: 'createdAt',
      title: t('history.columns.time'),
      sorter: true,
      sortOrder: query.order === 'asc' ? 'ascend' : 'descend',
      fixed: 'left',
      render: (_: unknown, row) => <DiscordTimestamp value={row.createdAt} />,
    },
    {
      key: 'member',
      title: t('history.columns.member'),
      width: 180,
      render: (_: unknown, row) => (
        <div style={{ overflowWrap: 'anywhere' }}>
          <div>{row.displayName ?? row.userId}</div>
          {row.displayName === null ? null : (
            <Typography.Text type="secondary">{row.userId}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'channel',
      title: t('history.columns.channel'),
      render: (_: unknown, row) => channelName(row.channelId),
    },
    {
      key: 'status',
      title: t('history.columns.status'),
      render: (_: unknown, row) => (
        <div>
          <Tag color={STATUS_COLOR[row.status]}>{statusLabels[row.status]}</Tag>
          {row.failureReason === null ? null : (
            <Typography.Text type="secondary" style={{ display: 'block' }}>
              {tLlm(`llm.form.testReasons.${row.failureReason}`)}
            </Typography.Text>
          )}
        </div>
      ),
    },
    {
      key: 'question',
      title: t('history.columns.question'),
      width: 320,
      render: (_: unknown, row) => <div style={CLAMP}>{row.question}</div>,
    },
    {
      key: 'tokens',
      title: t('history.columns.tokens'),
      align: 'right',
      render: (_: unknown, row) =>
        `${row.estimated ? '≈ ' : ''}${count(row.inputTokens)} / ${count(row.outputTokens)}`,
    },
    {
      key: 'actions',
      title: t('history.columns.actions'),
      render: (_: unknown, row) => (
        <Button
          aria-label={t('history.viewLabel', { name: row.displayName ?? row.userId })}
          onClick={() => setOpenId(row.id)}
        >
          {t('history.view')}
        </Button>
      ),
    },
  ];

  return (
    <Card title={t('history.title')}>
      <Typography.Paragraph type="secondary">
        {t('history.description', { days: CHATBOT_HISTORY_RETENTION_DAYS })}
      </Typography.Paragraph>
      <ActionRow style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <MemberSelect
            guildId={guildId}
            aria-label={t('history.filters.member')}
            placeholder={t('history.filters.member')}
            allowClear
            disabled={navigating}
            value={query.userId}
            onChange={(userId) => filter({ userId })}
          />
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <ChannelSelect
            guildId={guildId}
            types={TEXT_CHANNEL_TYPES}
            aria-label={t('history.filters.channel')}
            placeholder={t('history.filters.channel')}
            allowClear
            disabled={navigating}
            value={query.channelId}
            onChange={(channelId) => filter({ channelId })}
          />
        </div>
        <Select<Status>
          aria-label={t('history.filters.status')}
          placeholder={t('history.filters.status')}
          allowClear
          disabled={navigating}
          value={query.status}
          style={{ flex: '1 1 160px', minWidth: 0 }}
          options={STATUSES.map((value) => ({ value, label: statusLabels[value] }))}
          onChange={(status) => filter({ status })}
        />
      </ActionRow>
      <ActionRow style={{ marginBottom: 'var(--space-4)' }}>
        <Input
          type="date"
          aria-label={t('history.filters.from')}
          disabled={navigating}
          value={dayOf(query.from)}
          max={dayOf(query.to) === '' ? undefined : dayOf(query.to)}
          onChange={(event) => filter({ from: dayStartIso(event.target.value) })}
          style={{ flex: '1 1 160px', minWidth: 0, width: 'auto' }}
        />
        <Input
          type="date"
          aria-label={t('history.filters.to')}
          disabled={navigating}
          value={dayOf(query.to)}
          min={dayOf(query.from) === '' ? undefined : dayOf(query.from)}
          onChange={(event) => filter({ to: dayEndIso(event.target.value) })}
          style={{ flex: '1 1 160px', minWidth: 0, width: 'auto' }}
        />
        {hasTurnFilter(query) ? (
          <Button
            disabled={navigating}
            onClick={() =>
              go({
                ...query,
                page: 1,
                userId: undefined,
                channelId: undefined,
                status: undefined,
                from: undefined,
                to: undefined,
              })
            }
          >
            {t('history.filters.clear')}
          </Button>
        ) : null}
      </ActionRow>
      <Table<Row>
        rowKey="id"
        loading={navigating}
        dataSource={page.items}
        columns={columns}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText: hasTurnFilter(query) ? t('history.emptyFiltered') : t('history.empty'),
        }}
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
      <ActionRow style={{ marginTop: 'var(--space-4)' }}>
        {query.userId === undefined ? null : (
          <ChatbotTurnDelete
            guildId={guildId}
            target={{ scope: 'user', userId: query.userId }}
            label={t('history.delete.member')}
          />
        )}
        <ChatbotTurnDelete
          guildId={guildId}
          target={{ scope: 'all' }}
          label={t('history.delete.all')}
        />
      </ActionRow>
      <ChatbotTurnDrawer
        guildId={guildId}
        turnId={openId}
        channelName={channelName}
        onClose={() => setOpenId(undefined)}
      />
    </Card>
  );
}
