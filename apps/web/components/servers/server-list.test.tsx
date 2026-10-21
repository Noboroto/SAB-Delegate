import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';
import { ServerList } from './server-list';

const screens = vi.hoisted<{ current: Record<string, boolean> }>(() => ({ current: {} }));
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<{ Grid: object }>();
  return { ...actual, Grid: { ...actual.Grid, useBreakpoint: () => screens.current } };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
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
  beforeEach(() => {
    screens.current = { xs: false, sm: true, md: true, lg: true, xl: true };
  });

  it('prints each name once and marks its icon decorative, so it is not read twice', () => {
    const { container } = renderWithProviders(<ServerList guilds={[present]} />);
    expect(screen.getAllByText('Alpha')).toHaveLength(1);
    const icon = container.querySelector('img');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('alt')).toBe('');
  });

  it('opens the dashboard of a server that has the bot', () => {
    renderWithProviders(<ServerList guilds={[present]} />);
    expect(screen.getByRole('link', { name: 'Mở bảng điều khiển của Alpha' })).toHaveAttribute(
      'href',
      `/servers/${WITH_BOT}`,
    );
    expect(screen.queryByRole('link', { name: 'Mời bot' })).toBeNull();
  });

  const absentN = (n: number) => ({
    id: String(n).padStart(18, '4'),
    name: `Server ${n}`,
    icon: null,
    botPresent: false,
    invite: { clientId: CLIENT_ID, permissions: '123456' },
  });

  it.each([
    ['vi' as const, 'Quản lý máy chủ', 'Mời bot vào máy chủ'],
    ['en' as const, 'Manage servers', 'Invite the bot to a server'],
  ])('splits servers into a manage group and an invite group (%s)', (locale, manage, invite) => {
    renderWithProviders(<ServerList guilds={[absent, present]} />, locale);
    const manageGroup = within(screen.getByRole('region', { name: manage }));
    expect(manageGroup.getByText('Alpha')).toBeInTheDocument();
    expect(manageGroup.queryByText('Beta')).toBeNull();
    const inviteGroup = within(screen.getByRole('region', { name: invite }));
    expect(inviteGroup.getByText('Beta')).toBeInTheDocument();
    expect(inviteGroup.queryByText('Alpha')).toBeNull();
  });

  it.each([
    ['vi' as const, 'Mời bot', 'Mời bot vào Beta'],
    ['en' as const, 'Invite bot', 'Invite the bot to Beta'],
  ])('offers one general invite without a server and one per server (%s)', (locale, label, per) => {
    renderWithProviders(<ServerList guilds={[absent]} />, locale);
    const general = new URL(screen.getByRole('link', { name: label }).getAttribute('href') ?? '');
    expect(general.origin + general.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(general.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(general.searchParams.get('permissions')).toBe('123456');
    expect(general.searchParams.get('scope')).toBe('bot applications.commands');
    expect(general.searchParams.has('guild_id')).toBe(false);
    expect(general.searchParams.has('disable_guild_select')).toBe(false);

    const link = screen.getByRole('link', { name: per });
    const url = new URL(link.getAttribute('href') ?? '');
    expect(url.searchParams.get('guild_id')).toBe(WITHOUT_BOT);
    expect(url.searchParams.get('disable_guild_select')).toBe('true');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(screen.queryByRole('link', { name: /bảng điều khiển|dashboard/i })).toBeNull();
  });

  it.each([
    [{ xl: true, lg: true, sm: true }, 4],
    [{ lg: true, sm: true }, 3],
    [{ sm: true }, 2],
    [{ xs: true }, 1],
    [{}, 4],
  ])('shows one row of invitable servers: %j gives %i', (width, count) => {
    screens.current = width;
    renderWithProviders(<ServerList guilds={[1, 2, 3, 4, 5, 6, 7, 8, 9].map(absentN)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(count);
    expect(screen.getByRole('button', { name: `Xem thêm (${9 - count})` })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('toggles the rest open and closed and moves focus to the first revealed server', async () => {
    const many = [1, 2, 3, 4, 5, 6, 7].map(absentN);
    renderWithProviders(<ServerList guilds={many} />);
    expect(screen.queryByText('Server 5')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Xem thêm (3)' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('link', { name: 'Mời bot vào Server 5' })).toHaveFocus();
    const toggle = screen.getByRole('button', { name: 'Thu gọn' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
  });

  it('has no toggle when one row is enough', () => {
    renderWithProviders(<ServerList guilds={[1, 2, 3, 4].map(absentN)} />, 'en');
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
  });

  it('says the bot is nowhere yet when servers can be invited to, and keeps the old text for no servers', () => {
    const { unmount } = renderWithProviders(<ServerList guilds={[present]} />);
    expect(screen.queryByRole('region', { name: 'Mời bot vào máy chủ' })).toBeNull();
    unmount();
    const second = renderWithProviders(<ServerList guilds={[absent]} />);
    expect(
      screen.getByText('Bot chưa ở máy chủ nào của bạn. Mời bot ở bên dưới.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Chưa có máy chủ nào/)).toBeNull();
    second.unmount();
    renderWithProviders(<ServerList guilds={[]} />);
    expect(screen.getByText(/Chưa có máy chủ nào\. Bạn cần quyền/)).toBeInTheDocument();
  });

  it('leaves out servers that have no invite link', () => {
    renderWithProviders(<ServerList guilds={[{ ...absent, invite: null }]} />);
    expect(screen.queryByText('Beta')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Mời bot vào máy chủ' })).toBeNull();
  });

  it('nests no button inside a link', () => {
    const { container } = renderWithProviders(<ServerList guilds={[present, absent]} />);
    expect(container.querySelector('a button, button a')).toBeNull();
  });
});
