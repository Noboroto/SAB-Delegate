import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', () => ({ signInWithDiscord: signIn }));

import { LoginCard } from './login-card';

describe('LoginCard', () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it('starts Discord sign-in once, with the page to return to, and ignores a second click', async () => {
    signIn.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<LoginCard next="/servers/5" />);

    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập bằng Discord' }));
    // The label stays put while the redirect starts, so the button does not jump.
    const button = screen.getByRole('button', { name: /Đăng nhập bằng Discord/ });
    await userEvent.click(button);

    expect(signIn).toHaveBeenCalledOnce();
    expect(signIn).toHaveBeenCalledWith('/servers/5');
  });

  it('is the page heading', () => {
    renderWithProviders(<LoginCard next="/servers" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Đăng nhập' })).toBeInTheDocument();
  });

  it('shows a translated error, not the cause, and lets the person try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signIn.mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.1'));
    renderWithProviders(<LoginCard next="/servers" />, 'en');

    await userEvent.click(screen.getByRole('button', { name: 'Sign in with Discord' }));

    expect(
      await screen.findByText('Sign-in could not be started. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ECONNREFUSED/)).not.toBeInTheDocument();
    // The spinner icon leaves with an animation and keeps its label for a moment.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Sign in with Discord/ })).toBeEnabled(),
    );
  });

  it('says what permission is needed and what is read', () => {
    renderWithProviders(<LoginCard next="/servers" />);
    expect(screen.getByText(/Quản lý máy chủ/)).toBeInTheDocument();
    expect(screen.getByText(/không được lưu lại/)).toBeInTheDocument();
  });
});
