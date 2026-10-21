import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL, GUILD, stubApi } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const server = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: async (path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
    parser.parse(await server.fetch(path)),
}));
vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
const redirect = vi.hoisted(() =>
  vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
);
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => `/servers/${GUILD}/modules`,
}));

import MessagingPage, { generateMetadata as messagingMetadata } from './messaging/page';
import SchedulePage, { generateMetadata as scheduleMetadata } from './schedule/page';
import WordGamePage, { generateMetadata as wordGameMetadata } from './word-game/page';

const params = Promise.resolve({ guildId: GUILD });

beforeEach(() => {
  server.fetch.mockReset();
  stubApi(() => ({}));
});

describe('word game page', () => {
  it('reads the round and the requested page of words from the server', async () => {
    server.fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/words?')
          ? { items: [{ word: 'chào' }], pagination: { page: 2, pageSize: 20, total: 21 } }
          : {
              started: true,
              lastWord: 'chào',
              lastUserId: '5'.repeat(18),
              channelId: GENERAL,
              maxWords: 400,
              count: 21,
              finished: false,
            },
      ),
    );
    renderWithProviders(
      await WordGamePage({
        params,
        searchParams: Promise.resolve({ page: '2', sort: 'word', order: 'desc' }),
      }),
    );

    expect(server.fetch).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/word-game/words?page=2&pageSize=20&sort=word&order=desc`,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Trò nối từ' })).toBeInTheDocument();
    expect(screen.getByText('Các từ đã dùng (21)')).toBeInTheDocument();
    expect(await wordGameMetadata()).toEqual({ title: 'Trò nối từ' });
  });

  it('sends a link past the last page of words to the last page that exists', async () => {
    server.fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/words?')
          ? { items: [], pagination: { page: 9, pageSize: 20, total: 21 } }
          : {
              started: true,
              lastWord: 'chào',
              lastUserId: '5'.repeat(18),
              channelId: GENERAL,
              maxWords: 400,
              count: 21,
              finished: false,
            },
      ),
    );
    await expect(
      WordGamePage({ params, searchParams: Promise.resolve({ page: '9' }) }),
    ).rejects.toThrow('redirect:');
    expect(redirect).toHaveBeenCalledWith(
      `/servers/${GUILD}/modules/word-game?page=2&pageSize=20&sort=played&order=asc`,
    );
  });
});

describe('messaging page', () => {
  it('opens the form named in the URL', async () => {
    renderWithProviders(
      await MessagingPage({ params, searchParams: Promise.resolve({ tab: 'edit' }) }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Tin nhắn của bot' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'Sửa tin của bot', selected: true }),
    ).toBeInTheDocument();
    expect(await messagingMetadata()).toEqual({ title: 'Tin nhắn của bot' });
  });

  it('opens the first form for a tab it does not know', async () => {
    renderWithProviders(
      await MessagingPage({ params, searchParams: Promise.resolve({ tab: 'nope' }) }),
    );
    expect(screen.getByRole('tab', { name: 'Gửi tin', selected: true })).toBeInTheDocument();
  });
});

describe('schedule page', () => {
  it('asks the server for the pending messages and reads their times as instants', async () => {
    server.fetch.mockResolvedValue([
      {
        id: '0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        seq: 7,
        kind: 'SEND',
        runAt: '2026-10-20T02:30:00.000Z',
        status: 'PENDING',
        attempts: 0,
        source: 'HTTP',
        createdAt: '2026-10-14T05:00:00.000Z',
        channelId: GENERAL,
        content: 'Nhắc họp tối nay',
        sourceChannelId: null,
        sourceMessageId: null,
        createdByUserId: '5'.repeat(18),
        lastError: null,
        allowedMentions: { parse: [] },
      },
    ]);
    renderWithProviders(await SchedulePage({ params }));

    expect(server.fetch).toHaveBeenCalledWith(
      `/api/guilds/${GUILD}/schedules?status=PENDING&limit=100`,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Hẹn giờ gửi tin' })).toBeInTheDocument();
    expect(screen.getByText('Nhắc họp tối nay')).toBeInTheDocument();
    expect(screen.getByText(/09:30/)).toBeInTheDocument();
    expect(await scheduleMetadata()).toEqual({ title: 'Hẹn giờ gửi tin' });
  });
});
