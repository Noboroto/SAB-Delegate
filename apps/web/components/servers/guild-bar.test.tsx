import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GUILD_SECTIONS } from '@/lib/guild-sections';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const path = vi.hoisted(() => ({ current: '/servers/111111111111111111' }));
vi.mock('next/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { GuildBar } from './guild-bar';

const A = '1'.repeat(18);
const B = '2'.repeat(18);
const guilds = [
  { id: A, name: 'Alpha', icon: null },
  { id: B, name: 'Beta', icon: 'abc123' },
];

describe('GuildBar', () => {
  it('links every section of the server, in the page language', () => {
    path.current = `/servers/${A}`;
    renderWithProviders(<GuildBar guilds={guilds} currentId={A} />);
    const nav = screen.getByRole('menu');
    expect(within(nav).getByRole('link', { name: 'Tổng quan' })).toHaveAttribute(
      'href',
      `/servers/${A}`,
    );
    for (const section of GUILD_SECTIONS) {
      expect(nav.querySelector(`a[href="/servers/${A}/${section}"]`), section).not.toBeNull();
    }
  });

  it('marks the current section', () => {
    path.current = `/servers/${A}/logs`;
    renderWithProviders(<GuildBar guilds={guilds} currentId={A} />, 'en');
    expect(screen.getByRole('menuitem', { name: 'Logs' })).toHaveClass('ant-menu-item-selected');
    expect(screen.getByRole('menuitem', { name: 'Overview' })).not.toHaveClass(
      'ant-menu-item-selected',
    );
  });

  it('shows the current server in the switcher', () => {
    path.current = `/servers/${B}`;
    renderWithProviders(<GuildBar guilds={guilds} currentId={B} />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
