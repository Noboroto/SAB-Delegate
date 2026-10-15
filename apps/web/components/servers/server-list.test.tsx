import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ServerList } from './server-list';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

const WITH_BOT = '1'.repeat(18);
const WITHOUT_BOT = '2'.repeat(18);
const CLIENT_ID = '3'.repeat(18);

const present = { id: WITH_BOT, name: 'Alpha', icon: 'abc123', botPresent: true, invite: null };
const absent = {
  id: WITHOUT_BOT,
  name: 'Beta',
  icon: null,
  botPresent: false,
  invite: { clientId: CLIENT_ID, permissions: '123456' },
};

describe('ServerList', () => {
  it('prints each name once and marks its icon decorative, so it is not read twice', () => {
    const { container } = renderWithProviders(<ServerList guilds={[present]} />);
    expect(screen.getAllByText('Alpha')).toHaveLength(1);
    const icon = container.querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('alt')).toBe('');
  });

  it('opens the dashboard of a server that has the bot', () => {
    renderWithProviders(<ServerList guilds={[present]} />);
    expect(screen.getByRole('link', { name: 'Mở bảng điều khiển' })).toHaveAttribute(
      'href',
      `/servers/${WITH_BOT}`,
    );
    expect(screen.queryByRole('link', { name: 'Mời bot' })).toBeNull();
  });

  it.each([
    ['vi' as const, 'Mời bot', 'Bot chưa ở trong máy chủ này.'],
    ['en' as const, 'Invite bot', 'The bot is not in this server yet.'],
  ])('offers a new-tab invite for a server without the bot (%s)', (locale, label, hint) => {
    renderWithProviders(<ServerList guilds={[absent]} />, locale);
    const link = screen.getByRole('link', { name: label });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('guild_id')).toBe(WITHOUT_BOT);
    expect(url.searchParams.get('permissions')).toBe('123456');
    expect(url.searchParams.get('scope')).toBe('bot applications.commands');
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.getByText(hint)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /bảng điều khiển|dashboard/i })).toBeNull();
  });
});
