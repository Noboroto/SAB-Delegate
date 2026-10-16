import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERAL, GUILD, stubApi } from '@/lib/messaging/api-stub';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: async (path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
    parser.parse(await api.fetch(path)),
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
  redirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => `/servers/${GUILD}/modules/chatbot`,
}));

import ChatbotPage, { generateMetadata } from './page';

const params = Promise.resolve({ guildId: GUILD });
const MEMBER = '5'.repeat(18);

const CONFIG = {
  enabled: true,
  defaultMonthlyLimit: 100_000,
  channels: [GENERAL],
  llm: { source: 'none', baseUrl: null, model: null, keyLast4: null, globalAvailable: false },
};
const LLM_SETTINGS = {
  adminServer: true,
  available: true,
  enabled: false,
  baseUrl: null,
  model: null,
  keyLast4: null,
};
const QUOTA_PAGE = {
  items: [],
  pagination: { page: 1, pageSize: 10, total: 0 },
  period: '2026-10',
  defaultLimit: 100_000,
};
const TURN_PAGE = { items: [], pagination: { page: 1, pageSize: 10, total: 0 } };

function paths(): string[] {
  return api.fetch.mock.calls.map(([path]) => path as string);
}

beforeEach(() => {
  api.fetch.mockReset();
  redirect.mockClear();
  api.fetch.mockImplementation((path: string) => {
    if (path === `/api/guilds/${GUILD}/chatbot`) return Promise.resolve(CONFIG);
    if (path === `/api/guilds/${GUILD}/llm`) return Promise.resolve(LLM_SETTINGS);
    if (path.includes('/chatbot/quota?')) return Promise.resolve(QUOTA_PAGE);
    if (path.includes('/chatbot/turns?')) return Promise.resolve(TURN_PAGE);
    return Promise.reject(new Error(`unexpected read ${path}`));
  });
  stubApi(() => ({}));
});

describe('chatbot route', () => {
  it('titles the tab', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Chatbot' });
  });

  it('opens the settings and reads only what they need', async () => {
    renderWithProviders(
      await ChatbotPage({ params, searchParams: Promise.resolve({ tab: 'nope' }) }),
    );
    expect(paths().sort()).toEqual([`/api/guilds/${GUILD}/chatbot`, `/api/guilds/${GUILD}/llm`]);
    expect(screen.getByRole('heading', { level: 1, name: 'Chatbot' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cài đặt', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mở cài đặt dịch vụ dùng chung' })).toBeInTheDocument();
  });

  it('reads the page of usage the URL names, and nothing from the other tabs', async () => {
    renderWithProviders(
      await ChatbotPage({
        params,
        searchParams: Promise.resolve({ tab: 'usage', page: '2', sort: 'limit', order: 'asc' }),
      }),
    );
    expect(paths()).toEqual([
      `/api/guilds/${GUILD}/chatbot`,
      `/api/guilds/${GUILD}/chatbot/quota?page=2&pageSize=10&order=asc&sort=limit`,
    ]);
    expect(screen.getByRole('tab', { name: 'Mức dùng', selected: true })).toBeInTheDocument();
  });

  it('sends a link past the end of the usage list to the last page that exists', async () => {
    api.fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/chatbot/quota?')
          ? { ...QUOTA_PAGE, pagination: { page: 5, pageSize: 10, total: 15 } }
          : CONFIG,
      ),
    );
    await expect(
      ChatbotPage({ params, searchParams: Promise.resolve({ tab: 'usage', page: '5' }) }),
    ).rejects.toThrow('redirect:');
    expect(redirect).toHaveBeenCalledWith(
      `/servers/${GUILD}/modules/chatbot?tab=usage&page=2&pageSize=10&order=desc&sort=used`,
    );
  });

  it('sends a link past the end of the history to the first page when nothing is left', async () => {
    api.fetch.mockImplementation((path: string) =>
      Promise.resolve(
        path.includes('/chatbot/turns?')
          ? { items: [], pagination: { page: 3, pageSize: 10, total: 0 } }
          : CONFIG,
      ),
    );
    await expect(
      ChatbotPage({ params, searchParams: Promise.resolve({ tab: 'history', page: '3' }) }),
    ).rejects.toThrow('redirect:');
    expect(redirect).toHaveBeenCalledWith(
      `/servers/${GUILD}/modules/chatbot?tab=history&page=1&pageSize=10&order=desc`,
    );
  });

  it('reads the history with the filters of the URL for the server to apply', async () => {
    renderWithProviders(
      await ChatbotPage({
        params,
        searchParams: Promise.resolve({ tab: 'history', userId: MEMBER, status: 'bogus' }),
      }),
    );
    expect(paths()).toEqual([
      `/api/guilds/${GUILD}/chatbot`,
      `/api/guilds/${GUILD}/chatbot/turns?page=1&pageSize=10&order=desc&userId=${MEMBER}`,
    ]);
    expect(screen.getByRole('tab', { name: 'Lịch sử', selected: true })).toBeInTheDocument();
  });
});
