import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const signOut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', () => ({ signOut }));
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { UserMenu } from './user-menu';

describe('UserMenu', () => {
  beforeEach(() => {
    signOut.mockReset();
    push.mockReset();
  });

  it('signs out from the menu', async () => {
    signOut.mockResolvedValue(undefined);
    renderWithProviders(<UserMenu />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(await screen.findByText('Sign out'));
    expect(signOut).toHaveBeenCalledOnce();
  });

  it.each([
    ['en', 'API keys'],
    ['vi', 'Khoá API'],
  ] as const)('opens the API keys page from the whole row in %s', async (locale, label) => {
    renderWithProviders(<UserMenu />, locale);
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
    renderWithProviders(<UserMenu />, 'en');
    await userEvent.click(screen.getByRole('button', { name: 'Account' }));
    await userEvent.click(await screen.findByText('Sign out'));
    expect(await screen.findByText('Could not sign out. Please try again.')).toBeInTheDocument();
    expect(screen.queryByText(/socket hang up/)).not.toBeInTheDocument();
  });
});
