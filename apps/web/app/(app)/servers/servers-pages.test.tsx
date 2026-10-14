import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/api/api-response';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const guilds = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/guilds', () => ({
  getGuilds: (): Promise<unknown> => guilds.get() as Promise<unknown>,
}));
vi.mock('next-intl/server', async () => {
  const { serverTranslations } = await import('@/lib/test/server-translations');
  const translate = serverTranslations();
  return { getTranslations: (namespace: string) => translate(namespace) };
});
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
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
import GuildSectionPage from './[guildId]/[section]/page';
import ServersPage from './page';

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
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).toEqual([`/servers/${A}`, `/servers/${B}`]);
  });

  it('explains an empty list instead of showing a blank page', async () => {
    guilds.get.mockResolvedValue([]);
    renderWithProviders(await ServersPage());
    expect(screen.getByText('Chưa có máy chủ nào')).toBeInTheDocument();
  });

  it('asks to sign in again when the login cannot read the list', async () => {
    guilds.get.mockRejectedValue(new ApiRequestError(403, 'AUTH_REAUTH_REQUIRED'));
    renderWithProviders(await ServersPage());
    expect(screen.getByText('Cần đăng nhập lại')).toBeInTheDocument();
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
    ).rejects.toThrow('NOT_FOUND');
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

describe('server dashboard sections', () => {
  it('shows a stub for a known section and a 404 for any other path', async () => {
    renderWithProviders(
      await GuildSectionPage({ params: Promise.resolve({ guildId: A, section: 'logs' }) }),
    );
    expect(screen.getByText('Nhật ký')).toBeInTheDocument();
    await expect(
      GuildSectionPage({ params: Promise.resolve({ guildId: A, section: 'admin' }) }),
    ).rejects.toThrow('NOT_FOUND');
  });
});
