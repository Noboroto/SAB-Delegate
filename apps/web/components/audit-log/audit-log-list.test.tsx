import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import type { WebAuditLogPage } from '@/lib/audit-log/audit-logs';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { AuditLogList } from './audit-log-list';

const GUILD = '1'.repeat(18);
const NEXT = '0199c0a8-1111-7222-8333-444455556666';

const page: WebAuditLogPage = {
  items: [
    {
      id: 'a',
      source: 'HTTP',
      actorDiscordId: '222222222222222222',
      apiKeyId: null,
      action: 'note.upsert',
      params: { key: '<img src=x onerror=alert(1)>' },
      ok: true,
      error: null,
      createdAt: new Date('2026-10-14T05:30:00Z'),
    },
    {
      id: 'b',
      source: 'DISCORD',
      actorDiscordId: null,
      apiKeyId: null,
      action: 'purge.messages',
      params: null,
      ok: false,
      error: 'FORBIDDEN',
      createdAt: new Date('2026-10-13T05:30:00Z'),
    },
  ],
  nextCursor: NEXT,
};

const TEXT = {
  vi: {
    title: 'Nhật ký',
    action: 'Lưu ghi chú',
    source: 'Web / API',
    failed: 'Thất bại',
    older: 'Cũ hơn',
    newest: 'Về mới nhất',
    empty: 'Chưa có thao tác nào được ghi.',
    emptyFiltered: 'Không có thao tác nào khớp bộ lọc.',
    clearFilters: 'Xoá bộ lọc',
    filter: 'Lọc theo thao tác',
    sourceFilter: 'Lọc theo nguồn',
    mcp: 'MCP',
  },
  en: {
    title: 'Audit log',
    action: 'Note saved',
    source: 'Web / API',
    failed: 'Failed',
    older: 'Older',
    newest: 'Back to newest',
    empty: 'No actions have been recorded yet.',
    emptyFiltered: 'No action matches the filter.',
    clearFilters: 'Clear filters',
    filter: 'Filter by action',
    sourceFilter: 'Filter by source',
    mcp: 'MCP',
  },
} as const;

const OPTION = '.ant-select-item-option-content';

beforeEach(() => push.mockReset());

describe.each(SUPPORTED_LOCALES)('AuditLogList (%s)', (locale) => {
  const text = TEXT[locale];

  it('shows each row in plain text, with a time element and a link to older rows', () => {
    const { container } = renderWithProviders(
      <AuditLogList guildId={GUILD} page={page} filter={{}} />,
      locale,
    );
    expect(screen.getByRole('heading', { level: 1, name: text.title })).toBeInTheDocument();
    expect(screen.getByText(text.action)).toBeInTheDocument();
    expect(screen.getByText(text.source)).toBeInTheDocument();
    // The tag is the translated status; the stored error is plain text beside it.
    expect(screen.getByText(text.failed)).toBeInTheDocument();
    expect(screen.getByText('FORBIDDEN')).toBeInTheDocument();
    expect(container.querySelector('a button, button a')).toBeNull();
    expect(container.querySelectorAll('time')).toHaveLength(2);
    // The payload is text, never markup.
    expect(screen.getByText(/onerror=alert\(1\)/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('link', { name: text.older })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/audit-log?cursor=${NEXT}`,
    );
    expect(screen.queryByRole('link', { name: text.newest })).toBeNull();
  });

  it('keeps the action filter in the links and offers the way back to the newest rows', () => {
    renderWithProviders(
      <AuditLogList guildId={GUILD} page={page} filter={{ action: 'note.upsert', cursor: NEXT }} />,
      locale,
    );
    expect(screen.getByRole('link', { name: text.newest })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/audit-log?action=note.upsert`,
    );
    expect(screen.getByRole('link', { name: text.older })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/audit-log?action=note.upsert&cursor=${NEXT}`,
    );
  });

  it('shows an empty message, a different one under a filter, and no older link on the last page', () => {
    const empty = { items: [], nextCursor: null };
    const first = renderWithProviders(
      <AuditLogList guildId={GUILD} page={empty} filter={{}} />,
      locale,
    );
    expect(screen.getByText(text.empty)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: text.older })).toBeNull();
    first.unmount();
    renderWithProviders(
      <AuditLogList guildId={GUILD} page={empty} filter={{ action: 'note.upsert' }} />,
      locale,
    );
    expect(screen.getByText(text.emptyFiltered)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: text.clearFilters })).toBeInTheDocument();
  });

  it('asks the server for the chosen action instead of filtering the rows', async () => {
    renderWithProviders(<AuditLogList guildId={GUILD} page={page} filter={{}} />, locale);
    // The option list is virtual: typing narrows it so the option is rendered.
    await userEvent.type(screen.getByRole('combobox', { name: text.filter }), text.action);
    await userEvent.click(await screen.findByText(text.action, { selector: OPTION }));
    expect(push).toHaveBeenCalledWith(`/servers/${GUILD}/audit-log?action=note.upsert`);
  });

  it('asks the server for the chosen source and keeps the action, dropping the old cursor', async () => {
    renderWithProviders(
      <AuditLogList guildId={GUILD} page={page} filter={{ action: 'note.upsert', cursor: NEXT }} />,
      locale,
    );
    await userEvent.click(screen.getByRole('combobox', { name: text.sourceFilter }));
    await userEvent.click(await screen.findByText(text.mcp, { selector: OPTION }));
    expect(push).toHaveBeenCalledWith(`/servers/${GUILD}/audit-log?action=note.upsert&source=MCP`);
  });

  it('keeps the source filter in the paging links', () => {
    renderWithProviders(
      <AuditLogList guildId={GUILD} page={page} filter={{ source: 'HTTP', cursor: NEXT }} />,
      locale,
    );
    expect(screen.getByRole('link', { name: text.newest })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/audit-log?source=HTTP`,
    );
    expect(screen.getByRole('link', { name: text.older })).toHaveAttribute(
      'href',
      `/servers/${GUILD}/audit-log?source=HTTP&cursor=${NEXT}`,
    );
  });
});
