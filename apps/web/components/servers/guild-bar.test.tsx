import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GUILD_NAV } from '@/lib/guild-sections';
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
    for (const entry of GUILD_NAV) {
      if (entry.path === undefined || entry.path === '') continue;
      expect(nav.querySelector(`a[href="/servers/${A}/${entry.path}"]`), entry.key).not.toBeNull();
    }
    expect(within(nav).getByText('Công cụ')).toBeInTheDocument();
  });

  it('keeps the sub-pages of modules and tools in the submenus', () => {
    path.current = `/servers/${A}`;
    const { container } = renderWithProviders(<GuildBar guilds={guilds} currentId={A} />);
    // The horizontal menu adds its own overflow ("...") submenu.
    const submenus = container.querySelectorAll(
      '.ant-menu-submenu:not(.ant-menu-overflow-item-rest)',
    );
    expect(submenus).toHaveLength(2);
  });

  it('selects the parent of a sub-page', () => {
    path.current = `/servers/${A}/modules/word-game`;
    const { container } = renderWithProviders(<GuildBar guilds={guilds} currentId={A} />, 'en');
    expect(container.querySelector('.ant-menu-submenu-selected')).toHaveTextContent('Modules');
    expect(screen.getByRole('menuitem', { name: 'Overview' })).not.toHaveClass(
      'ant-menu-item-selected',
    );
  });

  it('selects nothing on a path the menu does not know', () => {
    path.current = `/servers/${A}/nope`;
    const { container } = renderWithProviders(<GuildBar guilds={guilds} currentId={A} />);
    expect(container.querySelector('.ant-menu-item-selected')).toBeNull();
    expect(container.querySelector('.ant-menu-submenu-selected')).toBeNull();
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
