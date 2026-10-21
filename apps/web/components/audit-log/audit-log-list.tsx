'use client';

import { Button, Empty, Select, Table, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { AUDIT_ACTIONS, type AuditAction } from '@sab/shared';
import { DiscordTimestamp } from '@/components/data/discord-timestamp';
import { ActionRow } from '@/components/ui/action-row';
import { Heading } from '@/components/ui/heading';
import { LinkButton } from '@/components/ui/link-button';
import {
  AUDIT_ACTION_KEYS,
  type ActorSource,
  auditLogsQueryString,
  type AuditLogsFilter,
  type WebAuditLogPage,
} from '@/lib/audit-log/audit-logs';

interface AuditLogListProps {
  guildId: string;
  page: WebAuditLogPage;
  filter: AuditLogsFilter;
}

type Row = WebAuditLogPage['items'][number];

/** Both filters share one width so the toolbar reads as one row of equal controls. */
const FILTER_STYLE = { width: 'var(--w-sm)', maxWidth: '100%' } as const;

/** Long parameter and error text wraps inside the reading measure, so all of it can be read without hovering. */
const CELL_STYLE = { maxWidth: 'var(--measure)' } as const;

/** Plain text of a row's saved parameters; the server already keeps only allowlisted keys. */
function paramsText(params: unknown): string {
  if (params === null || params === undefined) return '';
  return JSON.stringify(params);
}

/** The audit trail, newest first. Filter and paging live in the URL so the server does the work. */
export function AuditLogList({ guildId, page, filter }: AuditLogListProps) {
  const t = useTranslations('web-audit-log');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const base = `/servers/${guildId}/audit-log`;

  // Typed record, so a source added to the schema cannot ship unlabelled.
  const sources: Record<Row['source'], string> = {
    DISCORD: t('sources.DISCORD'),
    HTTP: t('sources.HTTP'),
    MCP: t('sources.MCP'),
    SYSTEM: t('sources.SYSTEM'),
  };

  const actionLabel = (value: string): string => {
    const key = AUDIT_ACTION_KEYS[value];
    return key === undefined ? value : t(`actions.${key}`);
  };

  // A new filter starts from the newest row: the old cursor belongs to the old result.
  const changeFilter = (next: AuditLogsFilter) => {
    startTransition(() => {
      router.push(`${base}${auditLogsQueryString({ action: next.action, source: next.source })}`);
    });
  };
  const filtered = filter.action !== undefined || filter.source !== undefined;

  const older = page.nextCursor;

  return (
    <>
      <Heading title={t('title')} subtitle={t('subtitle')} />
      <ActionRow style={{ marginBottom: 'var(--space-4)' }}>
        <Select<AuditAction>
          aria-label={t('filter.action')}
          placeholder={t('filter.action')}
          allowClear
          showSearch={{ optionFilterProp: 'label' }}
          value={filter.action}
          disabled={pending}
          style={FILTER_STYLE}
          options={Object.values(AUDIT_ACTIONS).map((value) => ({
            value,
            label: actionLabel(value),
          }))}
          onChange={(value) => changeFilter({ ...filter, action: value })}
        />
        <Select<ActorSource>
          aria-label={t('filter.source')}
          placeholder={t('filter.source')}
          allowClear
          value={filter.source}
          disabled={pending}
          style={FILTER_STYLE}
          options={(Object.keys(sources) as ActorSource[]).map((value) => ({
            value,
            label: sources[value],
          }))}
          onChange={(value) => changeFilter({ ...filter, source: value })}
        />
      </ActionRow>
      <Table<Row>
        rowKey="id"
        loading={pending}
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={page.items}
        locale={{
          emptyText: filtered ? (
            <Empty description={t('emptyFiltered')}>
              <Button onClick={() => changeFilter({})}>{t('clearFilters')}</Button>
            </Empty>
          ) : (
            t('empty')
          ),
        }}
        columns={[
          {
            title: t('columns.time'),
            dataIndex: 'createdAt',
            render: (value: Date) => <DiscordTimestamp value={value} />,
          },
          {
            title: t('columns.action'),
            dataIndex: 'action',
            render: (value: string) => actionLabel(value),
          },
          {
            title: t('columns.source'),
            dataIndex: 'source',
            render: (value: Row['source']) => sources[value],
          },
          {
            title: t('columns.actor'),
            dataIndex: 'actorDiscordId',
            render: (value: string | null | undefined) =>
              value === null || value === undefined ? '-' : value,
          },
          {
            title: t('columns.result'),
            dataIndex: 'ok',
            render: (ok: boolean, row) =>
              ok ? (
                <Tag color="success">{t('result.ok')}</Tag>
              ) : (
                <div style={CELL_STYLE}>
                  <Tag color="error">{t('result.failed')}</Tag>
                  {row.error === null || row.error === undefined ? null : (
                    <Typography.Text
                      type="secondary"
                      style={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      {row.error}
                    </Typography.Text>
                  )}
                </div>
              ),
          },
          {
            title: t('columns.details'),
            dataIndex: 'params',
            render: (value: unknown) => {
              const text = paramsText(value);
              return text === '' ? (
                '-'
              ) : (
                <Typography.Text
                  code
                  style={{ ...CELL_STYLE, display: 'block', overflowWrap: 'anywhere' }}
                >
                  {text}
                </Typography.Text>
              );
            },
          },
        ]}
      />
      <ActionRow style={{ marginTop: 'var(--space-4)' }}>
        {filter.cursor === undefined ? null : (
          <LinkButton
            href={`${base}${auditLogsQueryString({ action: filter.action, source: filter.source })}`}
          >
            {t('newest')}
          </LinkButton>
        )}
        {older === null ? null : (
          <LinkButton
            variant="primary"
            href={`${base}${auditLogsQueryString({ action: filter.action, source: filter.source, cursor: older })}`}
          >
            {t('older')}
          </LinkButton>
        )}
      </ActionRow>
    </>
  );
}
