'use client';

import { Table, Tag, Typography, type TableColumnsType } from 'antd';
import { useLocale, useTranslations } from 'next-intl';
import type { ApiKeyView } from '@sab/shared';
import { formatDateTime } from '@/lib/format-datetime';
import { apiKeyStatus, type ApiKeyStatus } from '@/lib/api-keys/key-status';
import type { SupportedLocale } from '@/lib/locale';
import { RevokeKeyButton } from './revoke-key-button';

const STATUS_COLOR: Record<ApiKeyStatus, string> = {
  active: 'green',
  expired: 'default',
  revoked: 'red',
};

/**
 * The person's own keys: a short list the server returns whole (at most a few
 * active ones plus the history), so it is paged here and not by query. It
 * scrolls inside its frame at phone width. Status is a word, not only a colour.
 */
export function ApiKeysTable({ keys, now }: { keys: readonly ApiKeyView[]; now: number }) {
  const t = useTranslations('web-api-keys');
  const locale = useLocale() as SupportedLocale;

  const columns: TableColumnsType<ApiKeyView> = [
    {
      title: t('table.name'),
      dataIndex: 'name',
      render: (name: string) => <span style={{ overflowWrap: 'anywhere' }}>{name}</span>,
    },
    {
      title: t('table.prefix'),
      dataIndex: 'prefix',
      render: (prefix: string) => <Typography.Text code>{prefix}</Typography.Text>,
    },
    {
      title: t('table.mode'),
      dataIndex: 'mode',
      render: (mode: ApiKeyView['mode']) => (
        <Tag color={mode === 'WRITE' ? 'orange' : 'blue'}>{t(`mode.${mode}`)}</Tag>
      ),
    },
    {
      title: t('table.createdAt'),
      dataIndex: 'createdAt',
      render: (createdAt: Date) => formatDateTime(createdAt, locale),
    },
    {
      title: t('table.expiresAt'),
      dataIndex: 'expiresAt',
      render: (expiresAt: Date | null) =>
        expiresAt === null ? t('table.neverExpires') : formatDateTime(expiresAt, locale),
    },
    {
      title: t('table.lastUsed'),
      key: 'lastUsed',
      render: (_: unknown, key) =>
        key.lastUsedAt === null ? (
          t('table.neverUsed')
        ) : (
          <>
            {formatDateTime(key.lastUsedAt, locale)}
            <br />
            <Typography.Text type="secondary">
              {key.lastUsedIp ?? t('table.ipUnknown')}
            </Typography.Text>
          </>
        ),
    },
    {
      title: t('table.status'),
      key: 'status',
      render: (_: unknown, key) => {
        const status = apiKeyStatus(key, now);
        return <Tag color={STATUS_COLOR[status]}>{t(`status.${status}`)}</Tag>;
      },
    },
    {
      title: t('table.actions'),
      key: 'actions',
      render: (_: unknown, key) =>
        key.revokedAt === null ? <RevokeKeyButton id={key.id} name={key.name} /> : null,
    },
  ];

  return (
    <Table<ApiKeyView>
      rowKey="id"
      columns={columns}
      dataSource={[...keys]}
      scroll={{ x: 'max-content' }}
      pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
      locale={{ emptyText: t('empty') }}
    />
  );
}
