import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMe = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/server-fetch', () => ({ serverFetch: fetchMe }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock('@/components/auth/login-card', () => ({
  LoginCard: ({ next }: { next: string }) => <div data-next={next} />,
}));

import LoginPage from './page';

const search = (next?: string) => Promise.resolve(next === undefined ? {} : { next });

describe('login page', () => {
  beforeEach(() => {
    fetchMe.mockReset();
  });

  it('sends a visitor who is already signed in on to where they were going', async () => {
    fetchMe.mockResolvedValue({ discordUserId: '1'.repeat(18) });
    await expect(LoginPage({ searchParams: search('/servers/9') })).rejects.toThrow(
      'REDIRECT:/servers/9',
    );
  });

  it('never redirects outside the site, even for a signed-in visitor', async () => {
    fetchMe.mockResolvedValue({ discordUserId: '1'.repeat(18) });
    await expect(LoginPage({ searchParams: search('//evil.example') })).rejects.toThrow(
      'REDIRECT:/servers',
    );
  });

  it('asks the server without letting a 401 redirect back to itself', async () => {
    fetchMe.mockRejectedValue(new Error('401'));
    await LoginPage({ searchParams: search() });
    expect(fetchMe).toHaveBeenCalledWith(
      '/api/me',
      expect.objectContaining({ onUnauthenticated: 'throw' }),
    );
  });

  it('still shows the sign-in button when the server is unreachable', async () => {
    fetchMe.mockRejectedValue(new Error('ECONNREFUSED'));
    const page = await LoginPage({ searchParams: search('/servers/9') });
    expect(JSON.stringify(page)).toContain('/servers/9');
  });
});
