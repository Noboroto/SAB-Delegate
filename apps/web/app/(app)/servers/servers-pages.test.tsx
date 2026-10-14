import { screen } from '@testing-library/react';
import type * as Navigation from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { renderWithProviders } from '@/lib/test/render-with-providers';

// The real `getGuilds` and its helpers run; only the HTTP call to the server is replaced.
const guilds = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: async (_path: string, { parser }: { parser: { parse(x: unknown): unknown } }) =>
    parser.parse(await (guilds.get() as Promise<unknown>)),
}));
vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
// `notFound` stays the real one: it throws the same 404 signal Next turns into the
// nearest `not-found.tsx`, so the tests see what the framework would.
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  usePathname: () => '/servers',
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/lib/auth/auth-client', () => ({ signInWithDiscord: vi.fn(() => Promise.resolve()) }));

import GuildLayout from './[guildId]/layout';
import GuildOverviewPage from './[guildId]/page';
import GuildSectionPage from './[guildId]/[section]/page';
import GuildNotFound from './not-found';
import ServersPage from './(picker)/page';

const NOT_FOUND_SIGNAL = { digest: 'NEXT_HTTP_ERROR_FALLBACK;404' };
const REAUTH = new ApiRequestError(403, 'AUTH_REAUTH_REQUIRED');

const A = '1'.repeat(18);
const B = '2'.repeat(18);
const list = [
  { id: A, name: 'Alpha', icon: null },
  { id: B, name: 'Beta', icon: null },
];

describe('servers page', () => {
  beforeEach(() => {
    guilds.get.mockReset();
  });

  it('lists the servers with a link into each dashboard', async () => {
    guilds.get.mockResolvedValue(list);
    renderWithProviders(await ServersPage());
    expect(screen.getByRole('heading', { level: 1, name: 'Chọn máy chủ' })).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).toEqual([`/servers/${A}`, `/servers/${B}`]);
  });

  it('explains an empty list instead of showing a blank page', async () => {
    guilds.get.mockResolvedValue([]);
    renderWithProviders(await ServersPage());
    expect(screen.getByText('Chưa có máy chủ nào')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('asks to sign in again when the login cannot read the list', async () => {
    guilds.get.mockRejectedValue(REAUTH);
    renderWithProviders(await ServersPage());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cần đăng nhập lại' }),
    ).toBeInTheDocument();
  });

  it('lets any other failure reach the error boundary', async () => {
    guilds.get.mockRejectedValue(new ApiRequestError(500, 'INTERNAL'));
    await expect(ServersPage()).rejects.toMatchObject({ status: 500 });
  });
});

describe('server dashboard layout', () => {
  beforeEach(() => {
    guilds.get.mockReset();
  });

  it('is the same not-found for a server the visitor may not manage as for one that does not exist', async () => {
    guilds.get.mockResolvedValue(list);
    await expect(
      GuildLayout({ children: null, params: Promise.resolve({ guildId: '3'.repeat(18) }) }),
    ).rejects.toMatchObject(NOT_FOUND_SIGNAL);
  });

  it('asks to sign in again when the login cannot read the list, instead of failing', async () => {
    guilds.get.mockRejectedValue(REAUTH);
    renderWithProviders(
      await GuildLayout({ children: <p>content</p>, params: Promise.resolve({ guildId: A }) }),
    );
    expect(screen.getByText('Cần đăng nhập lại')).toBeInTheDocument();
    expect(screen.queryByText('content')).not.toBeInTheDocument();
  });

  it('lets any other failure reach the error boundary', async () => {
    guilds.get.mockRejectedValue(new ApiRequestError(500, 'INTERNAL'));
    await expect(
      GuildLayout({ children: null, params: Promise.resolve({ guildId: A }) }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it('renders the navigation and the page for a server in the list', async () => {
    guilds.get.mockResolvedValue(list);
    renderWithProviders(
      await GuildLayout({ children: <p>content</p>, params: Promise.resolve({ guildId: A }) }),
    );
    expect(screen.getByText('content')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Cài đặt' })).toHaveAttribute(
      'href',
      `/servers/${A}/settings`,
    );
  });
});

describe('server dashboard pages', () => {
  beforeEach(() => {
    guilds.get.mockReset();
  });

  it('shows a stub for a known section with its title as the page heading, and a 404 for any other path', async () => {
    renderWithProviders(
      await GuildSectionPage({ params: Promise.resolve({ guildId: A, section: 'logs' }) }),
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Nhật ký' })).toBeInTheDocument();
    await expect(
      GuildSectionPage({ params: Promise.resolve({ guildId: A, section: 'admin' }) }),
    ).rejects.toMatchObject(NOT_FOUND_SIGNAL);
  });

  it('names the server on its overview page', async () => {
    guilds.get.mockResolvedValue(list);
    renderWithProviders(await GuildOverviewPage({ params: Promise.resolve({ guildId: A }) }));
    expect(screen.getByRole('heading', { level: 1, name: 'Alpha' })).toBeInTheDocument();
  });

  it('asks to sign in again on the overview page too', async () => {
    guilds.get.mockRejectedValue(REAUTH);
    renderWithProviders(await GuildOverviewPage({ params: Promise.resolve({ guildId: A }) }));
    expect(screen.getByText('Cần đăng nhập lại')).toBeInTheDocument();
  });
});

describe('server not-found screen', () => {
  it('says the server was not found or is not manageable, with one heading and a way back', async () => {
    renderWithProviders(await GuildNotFound());
    expect(
      screen.getByRole('heading', { level: 1, name: 'Không tìm thấy máy chủ' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Chọn máy chủ khác' })).toHaveAttribute(
      'href',
      '/servers',
    );
  });
});
