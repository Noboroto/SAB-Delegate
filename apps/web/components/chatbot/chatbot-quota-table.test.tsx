import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatbotQuotaListQuery, ChatbotQuotaPage, ChatbotQuotaRow } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { GUILD, bodyOf, stubApi, writesOf } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/chatbot',
}));

import { ChatbotQuotaTable } from './chatbot-quota-table';

const AN = '5'.repeat(18);
const GONE = '6'.repeat(18);

const AN_ROW: ChatbotQuotaRow = {
  userId: AN,
  displayName: 'An',
  used: 12_345,
  limit: 100_000,
  bonus: 500,
  overridden: false,
  remaining: 88_155,
};
const GONE_ROW: ChatbotQuotaRow = {
  userId: GONE,
  displayName: null,
  used: 0,
  limit: 200_000,
  bonus: 0,
  overridden: true,
  remaining: 200_000,
};

const PAGE: ChatbotQuotaPage = {
  items: [AN_ROW, GONE_ROW],
  pagination: { page: 1, pageSize: 10, total: 25 },
  period: '2026-10',
  defaultLimit: 100_000,
};
const QUERY: ChatbotQuotaListQuery = { page: 1, pageSize: 10, sort: 'used', order: 'desc' };

const QUOTA = `/api/guilds/${GUILD}/chatbot/quota`;

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    title: /Mức dùng .*2026/,
    used: 'Đã dùng',
    usedAn: '12.345',
    remainingAn: '88.155',
    custom: 'Hạn mức riêng',
    left: 'Không còn trong máy chủ',
    setLimitAn: 'Đặt hạn mức hàng tháng của An',
    setLimitGone: `Đặt hạn mức hàng tháng của ${GONE}`,
    addTokensAn: 'Thêm token cho An',
    resetAn: 'Đặt lại mức dùng của An',
    setLimit: 'Đặt hạn mức',
    addTokens: 'Thêm token',
    saveLimit: 'Lưu hạn mức',
    useDefault: 'Dùng hạn mức của máy chủ (100.000)',
    limitLabel: 'Token mỗi tháng',
    grantLabel: 'Số token thêm trong tháng này',
    resetConfirm: 'Đặt lại mức dùng',
    resetPlan:
      '12.345 token An đã dùng trong tháng này sẽ về 0. Token đã thêm trong tháng vẫn giữ nguyên.',
  },
  en: {
    title: 'Usage in October 2026',
    used: 'Used',
    usedAn: '12,345',
    remainingAn: '88,155',
    custom: 'Own limit',
    left: 'No longer in the server',
    setLimitAn: 'Set the monthly limit of An',
    setLimitGone: `Set the monthly limit of ${GONE}`,
    addTokensAn: 'Add tokens for An',
    resetAn: 'Reset the usage of An',
    setLimit: 'Set limit',
    addTokens: 'Add tokens',
    saveLimit: 'Save limit',
    useDefault: 'Use the server limit (100,000)',
    limitLabel: 'Tokens per month',
    grantLabel: 'Tokens to add this month',
    resetConfirm: 'Reset usage',
    resetPlan:
      'The 12,345 tokens An has used this month are set back to 0. Tokens added this month stay.',
  },
} as const;

function setup(locale: 'vi' | 'en', handler: (path: string, body: unknown) => unknown) {
  const fetchMock = stubApi((path, init) => handler(path, bodyOf(init)));
  renderWithProviders(<ChatbotQuotaTable guildId={GUILD} page={PAGE} query={QUERY} />, locale);
  return fetchMock;
}

beforeEach(() => {
  nav.refresh.mockReset();
  nav.push.mockReset();
});

describe.each(SUPPORTED_LOCALES)('ChatbotQuotaTable (%s)', (locale) => {
  const text = TEXT[locale];

  it('shows the month, the figures with the language separators, and who has their own limit', () => {
    setup(locale, () => ({}));
    expect(screen.getByText(text.title)).toBeInTheDocument();
    expect(screen.getByText('An')).toBeInTheDocument();
    expect(screen.getByText(text.usedAn)).toBeInTheDocument();
    expect(screen.getByText(text.remainingAn)).toBeInTheDocument();
    expect(screen.getAllByText(text.custom)).toHaveLength(1);
    expect(screen.getByText(text.left)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/web-chatbot|usage\.\w+/);
  });

  it('sorts through the URL, biggest spender first by default', async () => {
    setup(locale, () => ({}));
    // A fixed column makes AntD render the header twice (the second only measures widths).
    await userEvent.click(screen.getAllByText(text.used)[0] as HTMLElement);
    expect(nav.push).toHaveBeenCalledWith(
      '/servers/1/modules/chatbot?tab=usage&page=1&pageSize=10&order=asc&sort=used',
    );
  });

  it('moves to the chosen page through the URL', async () => {
    setup(locale, () => ({}));
    await userEvent.click(screen.getByTitle('2'));
    expect(nav.push).toHaveBeenCalledWith(
      '/servers/1/modules/chatbot?tab=usage&page=2&pageSize=10&order=desc&sort=used',
    );
  });

  it('sets a limit of the member`s own', async () => {
    const fetchMock = setup(locale, () => ({ ...AN_ROW, limit: 150_000, overridden: true }));
    await userEvent.click(screen.getByRole('button', { name: text.setLimitAn }));
    const dialog = await screen.findByRole('dialog');
    // A member on the server limit has nothing to drop.
    expect(within(dialog).queryByRole('button', { name: text.useDefault })).not.toBeInTheDocument();

    const input = within(dialog).getByLabelText(text.limitLabel);
    await userEvent.clear(input);
    await userEvent.type(input, '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: text.saveLimit }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${QUOTA}/${AN}`, method: 'PUT', body: { limit: 150_000 } },
    ]);
  });

  it('drops the own limit of a member so the server limit applies again', async () => {
    const fetchMock = setup(locale, () => ({ ...GONE_ROW, limit: 100_000, overridden: false }));
    await userEvent.click(screen.getByRole('button', { name: text.setLimitGone }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: text.useDefault }));

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${QUOTA}/${GONE}`, method: 'PUT', body: { limit: null } },
    ]);
  });

  it('takes tokens back with a negative number and refuses zero', async () => {
    const fetchMock = setup(locale, () => ({ ...AN_ROW, bonus: 0 }));
    await userEvent.click(screen.getByRole('button', { name: text.addTokensAn }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: text.addTokens });
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByLabelText(text.grantLabel);
    await userEvent.type(input, '0');
    expect(confirm).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, '-500');
    await userEvent.click(confirm);

    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${QUOTA}/${AN}/grant`, method: 'POST', body: { tokens: -500 } },
    ]);
  });

  it('shows what a reset clears before it clears anything', async () => {
    const fetchMock = setup(locale, (_path, body) => ({
      dryRun: (body as { dryRun: boolean }).dryRun,
      used: 12_345,
    }));
    await userEvent.click(screen.getByRole('button', { name: text.resetAn }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.resetPlan)).toBeInTheDocument();
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([{ dryRun: true }]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.resetConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock)).toEqual([
      { path: `${QUOTA}/${AN}/reset`, method: 'POST', body: { dryRun: true } },
      { path: `${QUOTA}/${AN}/reset`, method: 'POST', body: { dryRun: false } },
    ]);
  });

  it('keeps the member actions off until a member is picked', () => {
    setup(locale, () => ({}));
    // The two buttons of the picker row carry the plain label; the row buttons carry the member's name.
    expect(screen.getByRole('button', { name: text.setLimit })).toBeDisabled();
    expect(screen.getByRole('button', { name: text.addTokens })).toBeDisabled();
  });
});
