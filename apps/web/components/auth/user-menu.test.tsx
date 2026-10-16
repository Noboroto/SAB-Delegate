import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', () => ({ signOut }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { UserMenu } from './user-menu';

const NONE = { username: null, globalName: null, avatarUrl: null };
const SIGNED_IN = {
  username: 'sabi',
  globalName: 'Sabi Bot',
  avatarUrl: 'https://cdn.discordapp.com/avatars/200000000000000001/abc123.png?size=64',
};

describe('UserMenu', () => {
  beforeEach(() => {
    signOut.mockReset();
    push.mockReset();
  });

  it('signs out from the menu', async () => {
    signOut.mockResolvedValue(undefined);
    renderWithProviders(<UserMenu account={NONE} />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(await screen.findByText('Sign out'));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['en', 'API keys'],
    ['vi', 'Khoá API'],
  ] as const)('opens the API keys page from the whole row in %s', async (locale, label) => {
    renderWithProviders(<UserMenu account={NONE} />, locale);
    await userEvent.click(
      screen.getByRole('button', { name: locale === 'en' ? 'Account' : 'Tài khoản' }),
    );
    const item = await screen.findByRole('menuitem', { name: label });
    // A click on the row itself, not on a link inside it.
    await userEvent.click(item);
    expect(push).toHaveBeenCalledExactlyOnceWith('/account/api-keys');
  });

  it('tells the person when signing out failed, without the cause', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signOut.mockRejectedValue(new Error('socket hang up'));
    renderWithProviders(<UserMenu account={NONE} />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(await screen.findByText('Sign out'));
    expect(await screen.findByText('Could not sign out. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/socket hang up/)).not.toBeInTheDocument();
  });

  it('shows the avatar on the button and the name with @username in the menu', async () => {
    renderWithProviders(<UserMenu account={SIGNED_IN} />, 'en');
    const button = screen.getByRole('button', { name: 'Account: Sabi Bot' });
    expect(within(button).getByRole('img', { name: 'Sabi Bot' })).toHaveAttribute(
      'src',
      SIGNED_IN.avatarUrl,
    );
    await userEvent.click(button);
    expect(await screen.findByText('Sabi Bot')).toBeInTheDocument();
    expect(screen.getByText('@sabi')).toBeInTheDocument();
    expect(screen.getByText('Discord account')).toBeInTheDocument();
  });

  it('falls back to the username when the account has no display name', async () => {
    renderWithProviders(<UserMenu account={{ ...SIGNED_IN, globalName: null }} />, 'vi');
    await userEvent.click(screen.getByRole('button', { name: 'Tài khoản: sabi' }));
    expect(await screen.findByText('@sabi')).toBeInTheDocument();
    expect(screen.getByText('sabi')).toBeInTheDocument();
  });

  it('shows the plain icon and only the caption when Discord could not be asked', async () => {
    renderWithProviders(<UserMenu account={NONE} />, 'vi');
    const button = screen.getByRole('button', { name: 'Tài khoản' });
    expect(button.querySelector('img')).toBeNull();
    await userEvent.click(button);
    expect(await screen.findByText('Tài khoản Discord')).toBeInTheDocument();
    expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
  });
});
