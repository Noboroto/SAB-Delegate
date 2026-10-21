'use client';

import { useState, useTransition } from 'react';
import { App, Button, Card, Input, Table, Tag, Typography } from 'antd';
import type { TableProps } from 'antd';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  EMAIL_ADDRESS_MAX,
  type EmailMemberListQuery,
  type EmailMemberPage,
  type EmailMemberRow,
} from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { ConfirmAction } from '@/components/forms/confirm-action';
import { MemberSelect } from '@/components/forms/member-select';
import { ActionRow } from '@/components/ui/action-row';
import { useApiErrorMessage, useApiMutation } from '@/lib/api/mutations';
import { useUiLocale } from '@/lib/chatbot/use-ui-locale';
import { revokeEmailMember, verifyEmailMember } from '@/lib/email-verify/email-verify-api';
import { downloadMembersExport } from '@/lib/email-verify/export-download';
import { membersQueryString } from '@/lib/email-verify/members-query';
import { formatDateTime } from '@/lib/format-datetime';

type SortKey = NonNullable<EmailMemberListQuery['sort']>;

const SORTABLE: readonly SortKey[] = ['verifiedAt', 'domain'];

/** The members who verified, one page at a time; paging, order and search live in the URL and are answered by the server. */
export function MembersCard({
  guildId,
  page,
  query,
}: {
  guildId: string;
  page: EmailMemberPage;
  query: EmailMemberListQuery;
}) {
  const t = useTranslations('web-email-verify.members');
  const tCommon = useTranslations('web-common');
  const { message, modal } = App.useApp();
  const messageOf = useApiErrorMessage();
  const locale = useUiLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [navigating, startNavigation] = useTransition();
  const [userId, setUserId] = useState<string | undefined>(undefined);
  const [email, setEmail] = useState('');
  const { pagination } = page;

  const verify = useApiMutation((input: { userId: string; email: string }) =>
    verifyEmailMember(guildId, input),
  );
  const exportFile = useApiMutation(() => downloadMembersExport(guildId));

  const go = (next: EmailMemberListQuery) =>
    startNavigation(() => router.push(`${pathname}?tab=members&${membersQueryString(next)}`));

  const onVerify = async () => {
    if (userId === undefined || email.trim() === '') return;
    const outcome = await verify.run({ userId, email: email.trim() });
    if (outcome?.ok !== true) return;
    setUserId(undefined);
    setEmail('');
    void message.success(t('manualDone'));
    router.refresh();
  };

  const confirmExport = () => {
    modal.confirm({
      title: t('exportTitle'),
      content: t('exportConfirm'),
      okText: t('exportOk'),
      cancelText: tCommon('cancel'),
      async onOk() {
        const outcome = await exportFile.run(undefined);
        if (outcome?.ok === false) void message.error(messageOf(outcome.error));
      },
    });
  };

  const onTableChange: TableProps<EmailMemberRow>['onChange'] = (next, _filters, sorter) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const key = SORTABLE.find((candidate) => candidate === single?.columnKey);
    const sort = key ?? 'verifiedAt';
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

  const columns: TableProps<EmailMemberRow>['columns'] = [
    {
      key: 'member',
      title: t('member'),
      render: (_: unknown, row) => (
        <div style={{ overflowWrap: 'anywhere' }}>
          <div>{row.displayName ?? row.userId}</div>
          <Typography.Text type="secondary">
            {row.displayName === null ? t('left') : row.userId}
          </Typography.Text>
        </div>
      ),
    },
    {
      key: 'email',
      title: t('email'),
      render: (_: unknown, row) =>
        row.email === null ? (
          <Typography.Text type="secondary">{t('emailUnreadable')}</Typography.Text>
        ) : (
          <span style={{ overflowWrap: 'anywhere' }}>{row.email}</span>
        ),
    },
    {
      key: 'domain',
      title: t('domain'),
      dataIndex: 'domain',
      sorter: true,
      sortDirections: ['ascend', 'descend'],
      sortOrder: sortOrderOf('domain'),
    },
    {
      key: 'method',
      title: t('method'),
      render: (_: unknown, row) => <Tag>{t(`methods.${row.method}`)}</Tag>,
    },
    {
      key: 'verifiedAt',
      title: t('verifiedAt'),
      sorter: true,
      sortDirections: ['descend', 'ascend'],
      sortOrder: sortOrderOf('verifiedAt'),
      render: (_: unknown, row) => formatDateTime(row.verifiedAt, locale),
    },
    {
      key: 'actions',
      title: t('actions'),
      render: (_: unknown, row) => (
        <ConfirmAction
          label={t('revoke')}
          ariaLabel={t('revokeLabel', { name: row.displayName ?? row.userId })}
          modalTitle={t('revokeTitle')}
          confirmLabel={t('revoke')}
          // The service has no dry run for this; the plan is the member the row already shows.
          preview={() => Promise.resolve(row)}
          execute={() => revokeEmailMember(guildId, row.userId)}
          renderPlan={(plan) => (
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t('revokeConfirm', { name: plan.displayName ?? plan.userId })}
            </Typography.Paragraph>
          )}
          onDone={() => {
            void message.success(t('revoked'));
            router.refresh();
          }}
        />
      ),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <Card title={t('manual')}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onVerify();
          }}
          style={{ display: 'grid', gap: 'var(--space-3)' }}
        >
          <Typography.Text type="secondary">{t('manualHelp')}</Typography.Text>
          <ActionRow>
            <div style={{ flex: '1 1 var(--w-sm)', minWidth: 0 }}>
              <MemberSelect
                guildId={guildId}
                aria-label={t('manualUser')}
                placeholder={t('manualUser')}
                allowClear
                value={userId}
                onChange={(next) => {
                  verify.reset();
                  setUserId(next);
                }}
              />
            </div>
            <Input
              type="email"
              inputMode="email"
              autoComplete="off"
              aria-label={t('manualEmail')}
              placeholder={t('manualEmail')}
              maxLength={EMAIL_ADDRESS_MAX}
              value={email}
              onChange={(event) => {
                verify.reset();
                setEmail(event.target.value);
              }}
              style={{ flex: '1 1 var(--w-sm)', width: 'auto', minWidth: 0 }}
            />
            <Button
              type="primary"
              htmlType="submit"
              loading={verify.pending}
              disabled={userId === undefined || email.trim() === ''}
            >
              {t('manual')}
            </Button>
          </ActionRow>
          {verify.error === undefined ? null : <ErrorAlert error={verify.error} />}
        </form>
      </Card>
      <Card title={t('title')}>
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          <Typography.Text type="secondary">{t('intro')}</Typography.Text>
          <ActionRow>
            <Input.Search
              key={query.q ?? ''}
              defaultValue={query.q}
              allowClear
              maxLength={100}
              aria-label={t('search')}
              placeholder={t('search')}
              onSearch={(value) =>
                go({ ...query, q: value.trim() === '' ? undefined : value.trim(), page: 1 })
              }
              style={{ flex: '1 1 var(--w-sm)', width: 'auto', minWidth: 0 }}
            />
            <Button loading={exportFile.pending} onClick={confirmExport}>
              {t('export')}
            </Button>
          </ActionRow>
          <Table<EmailMemberRow>
            rowKey="userId"
            loading={navigating}
            dataSource={page.items}
            columns={columns}
            scroll={{ x: 'max-content' }}
            locale={{ emptyText: t('empty') }}
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
        </div>
      </Card>
    </div>
  );
}
