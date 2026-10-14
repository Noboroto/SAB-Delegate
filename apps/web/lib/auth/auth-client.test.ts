import { beforeEach, describe, expect, it, vi } from 'vitest';

const social = vi.hoisted(() => vi.fn());
const signOutCall = vi.hoisted(() => vi.fn());
const create = vi.hoisted(() => vi.fn(() => ({ signIn: { social }, signOut: signOutCall })));
vi.mock('better-auth/client', () => ({ createAuthClient: create }));

import { AuthClientError, signInWithDiscord, signOut } from './auth-client';

describe('auth client', () => {
  beforeEach(() => {
    social.mockReset();
    signOutCall.mockReset();
  });

  it('talks to /api/auth on the page origin, an absolute URL Better Auth accepts', async () => {
    social.mockResolvedValue({ error: null });
    await signInWithDiscord('/servers');
    expect(create).toHaveBeenCalledWith({ baseURL: `${window.location.origin}/api/auth` });
  });

  it('starts the Discord sign-in with a return path and an error page', async () => {
    social.mockResolvedValue({ error: null });
    await signInWithDiscord('/servers/1');
    expect(social).toHaveBeenCalledWith({
      provider: 'discord',
      callbackURL: '/servers/1',
      errorCallbackURL: '/auth-error',
    });
  });

  it('fails with a typed error that carries no library text', async () => {
    social.mockResolvedValue({ error: { code: 'BAD', message: 'internal detail' } });
    const error = (await signInWithDiscord().catch((e: unknown) => e)) as AuthClientError;
    expect(error).toBeInstanceOf(AuthClientError);
    expect(error.message).not.toContain('internal detail');
  });

  it('reports a sign-out failure instead of pretending to leave', async () => {
    signOutCall.mockResolvedValue({ error: { code: 'X' } });
    await expect(signOut()).rejects.toBeInstanceOf(AuthClientError);
  });
});
