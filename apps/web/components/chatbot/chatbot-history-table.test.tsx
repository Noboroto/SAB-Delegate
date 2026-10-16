import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatbotTurnDetail, ChatbotTurnListQuery, ChatbotTurnPage } from '@sab/shared';
import { SUPPORTED_LOCALES } from '@/lib/locale';
import { GENERAL, GUILD, bodyOf, stubApi, writesOf } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/servers/1/modules/chatbot',
}));

import { ChatbotHistoryTable } from './chatbot-history-table';

const AN = '5'.repeat(18);
const BINH = '6'.repeat(18);
const FIRST = '0190c1a2-0000-7000-8000-000000000001';
const SECOND = '0190c1a2-0000-7000-8000-000000000002';
const HOSTILE = '<script>alert(1)</script> **bold** [x](http://e.example)';

const FIRST_ROW = {
  id: FIRST,
  channelId: GENERAL,
  userId: AN,
  displayName: 'An',
  triggerMessageId: '7'.repeat(18),
  replyMessageId: null,
  status: 'OK',
  estimated: false,
  failureReason: null,
  question: HOSTILE,
  answer: 'Chào An',
  model: 'gpt-test',
  llmSource: 'global',
  inputTokens: 1200,
  outputTokens: 300,
  createdAt: '2026-10-16T08:00:00.000Z',
} as const satisfies ChatbotTurnPage['items'][number];

const SECOND_ROW = {
  ...FIRST_ROW,
  id: SECOND,
  userId: BINH,
  displayName: null,
  status: 'FAILED',
  failureReason: 'provider_quota',
  question: 'hello',
  answer: null,
  inputTokens: 0,
  outputTokens: 0,
} as const satisfies ChatbotTurnPage['items'][number];

const PAGE: ChatbotTurnPage = {
  items: [FIRST_ROW, SECOND_ROW],
  pagination: { page: 1, pageSize: 10, total: 2 },
};
const QUERY: ChatbotTurnListQuery = { page: 1, pageSize: 10, order: 'desc' };

const DETAIL: ChatbotTurnDetail = {
  id: FIRST,
  channelId: GENERAL,
  userId: AN,
  triggerMessageId: FIRST_ROW.triggerMessageId,
  replyMessageId: null,
  status: 'OK',
  estimated: false,
  failureReason: null,
  question: HOSTILE,
  answer: 'Chào An',
  model: 'gpt-test',
  llmSource: 'global',
  inputTokens: 1200,
  outputTokens: 300,
  createdAt: FIRST_ROW.createdAt,
  context: {
    system: 'SYSTEM <b>prompt</b>',
    channelMessages: [
      {
        authorName: 'Bình',
        authorId: BINH,
        content: 'hi <img src=x onerror=alert(1)>',
        at: '2026-10-16T07:59:00.000Z',
      },
    ],
    memory: { user: 'likes tea' },
    recentTurns: 0,
    attachments: [],
  },
};

const TURNS = `/api/guilds/${GUILD}/chatbot/turns`;

// Written out per language on purpose: the expectation must not come from the catalog it checks.
const TEXT = {
  vi: {
    answered: 'Đã trả lời',
    failed: 'Lỗi',
    reason: /hết hạn mức/,
    tokens: '1.200 / 300',
    viewAn: 'Xem lượt hỏi đáp của An',
    statusFilter: 'Chọn kết quả',
    from: 'Từ ngày',
    notice:
      'Mọi nội dung bên dưới là chữ thành viên đã viết và câu mô hình đã trả lời, hiển thị dưới dạng văn bản thuần.',
    messages: 'Tin trong kênh (1)',
    deleteAll: 'Xoá tất cả lượt hỏi đáp',
    deleteConfirm: 'Xoá lượt hỏi đáp',
    deletePlan: '2 lượt hỏi đáp sẽ bị xoá hẳn. Lượt đang chờ trả lời được giữ lại.',
    deleteOne: 'Xoá lượt hỏi đáp này',
  },
  en: {
    answered: 'Answered',
    failed: 'Failed',
    reason: /allowance or credit has run out/,
    tokens: '1,200 / 300',
    viewAn: 'View the exchange of An',
    statusFilter: 'Select an outcome',
    from: 'From day',
    notice:
      'Everything below is what members wrote and what the model answered, shown as plain text.',
    messages: 'Channel messages (1)',
    deleteAll: 'Delete all exchanges',
    deleteConfirm: 'Delete exchanges',
    deletePlan:
      '2 exchanges will be deleted for good. An exchange still waiting for its answer is kept.',
    deleteOne: 'Delete this exchange',
  },
} as const;

function setup(locale: 'vi' | 'en', handler: (path: string, body: unknown) => unknown) {
  const fetchMock = stubApi((path, init) => handler(path, bodyOf(init)));
  const view = renderWithProviders(
    <ChatbotHistoryTable guildId={GUILD} page={PAGE} query={QUERY} />,
    locale,
  );
  return { fetchMock, view };
}

beforeEach(() => {
  nav.refresh.mockReset();
  nav.push.mockReset();
});

describe.each(SUPPORTED_LOCALES)('ChatbotHistoryTable (%s)', (locale) => {
  const text = TEXT[locale];

  it('shows a member`s words as plain text, never as markup', () => {
    const { view } = setup(locale, () => ({}));
    expect(screen.getByText(HOSTILE)).toBeInTheDocument();
    expect(view.container.querySelector('script, strong, a[href="http://e.example"]')).toBeNull();
  });

  it('names the outcome of each exchange, the reason it failed, and the tokens', () => {
    setup(locale, () => ({}));
    expect(screen.getByText(text.answered)).toBeInTheDocument();
    expect(screen.getByText(text.failed)).toBeInTheDocument();
    expect(screen.getByText(text.reason)).toBeInTheDocument();
    expect(screen.getByText(text.tokens)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/web-chatbot|history\.\w+/);
  });

  it('filters by outcome through the URL and starts from the first page', async () => {
    setup(locale, () => ({}));
    await userEvent.click(screen.getByRole('combobox', { name: text.statusFilter }));
    await userEvent.click(
      await screen.findByText(text.failed, { selector: '.ant-select-item-option-content' }),
    );
    expect(nav.push).toHaveBeenCalledWith(
      '/servers/1/modules/chatbot?tab=history&page=1&pageSize=10&order=desc&status=FAILED',
    );
  });

  it('turns a picked day into the start of that day in the business zone', () => {
    setup(locale, () => ({}));
    fireEvent.change(screen.getByLabelText(text.from), { target: { value: '2026-10-16' } });
    expect(nav.push).toHaveBeenCalledWith(
      '/servers/1/modules/chatbot?tab=history&page=1&pageSize=10&order=desc&from=2026-10-15T17%3A00%3A00.000Z',
    );
  });

  it('opens the exchange with what the model was given, as plain text', async () => {
    const { view } = setup(locale, (path) => (path.endsWith(`/turns/${FIRST}`) ? DETAIL : {}));
    await userEvent.click(screen.getByRole('button', { name: text.viewAn }));

    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText(text.notice)).toBeInTheDocument();
    expect(within(drawer).getByText('Chào An')).toBeInTheDocument();

    await userEvent.click(within(drawer).getByText(text.messages));
    expect(await within(drawer).findByText('hi <img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(view.container.ownerDocument.querySelector('img')).toBeNull();
    expect(within(drawer).getByRole('button', { name: text.deleteOne })).toBeInTheDocument();
  });

  it('counts what a delete would remove and deletes only after the confirmation', async () => {
    const { fetchMock } = setup(locale, (_path, body) => ({
      dryRun: (body as { dryRun: boolean }).dryRun,
      count: 2,
    }));
    await userEvent.click(screen.getByRole('button', { name: text.deleteAll }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(text.deletePlan)).toBeInTheDocument();
    expect(writesOf(fetchMock)).toEqual([
      { path: TURNS, method: 'DELETE', body: { scope: 'all', dryRun: true } },
    ]);

    await userEvent.click(within(dialog).getByRole('button', { name: text.deleteConfirm }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(writesOf(fetchMock).map((call) => call.body)).toEqual([
      { scope: 'all', dryRun: true },
      { scope: 'all', dryRun: false },
    ]);
  });
});
