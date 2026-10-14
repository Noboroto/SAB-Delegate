import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/lib/test/render-with-providers';

const signIn = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth/auth-client', () => ({ signInWithDiscord: signIn }));
vi.mock('next/link', () => ({
  default: ({ children }: { children: React.ReactNode }) => children,
}));

import { ReauthState } from './reauth-state';

describe('ReauthState', () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it('starts one sign-in even when the button is hit twice in the same moment', () => {
    signIn.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<ReauthState />);
    const button = screen.getByRole('button', { name: 'Đăng nhập lại' });

    // Two clicks inside one act(): React has not re-rendered between them.
    act(() => {
      button.click();
      button.click();
    });

    expect(signIn).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: /Đăng nhập lại/ })).toHaveClass('ant-btn-loading');
  });

  it('is the page heading, and lets the person try again after a failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    signIn.mockRejectedValueOnce(new Error('network down'));
    renderWithProviders(<ReauthState />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Cần đăng nhập lại' }),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Đăng nhập lại' }));
    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Đăng nhập lại/ })).not.toHaveClass(
        'ant-btn-loading',
      );
    });

    signIn.mockReturnValue(new Promise(() => undefined));
    await userEvent.click(screen.getByRole('button', { name: /Đăng nhập lại/ }));
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});
