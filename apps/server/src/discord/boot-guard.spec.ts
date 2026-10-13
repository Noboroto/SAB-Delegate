import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Routes } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { BootGuard, BootGuardError, type DiscordEnv, type IdentityRest } from './boot-guard.js';

const APP_ID = '111111111111111111';
const OTHER_APP_ID = '222222222222222222';

// Generated per run: a literal would look like a leaked credential.
const token = `marker-${randomBytes(8).toString('hex')}`;

function guard(options: {
  rest: IdentityRest['get'];
  clientId?: string;
  allowed?: string[];
}): BootGuard {
  const env = {
    DISCORD_TOKEN: token,
    DISCORD_CLIENT_ID: options.clientId ?? APP_ID,
    DISCORD_ALLOWED_APP_IDS: options.allowed ?? [APP_ID],
  } as DiscordEnv;
  return new BootGuard({ get: options.rest }, env);
}

async function failureOf(promise: Promise<unknown>): Promise<BootGuardError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(BootGuardError);
  return error as BootGuardError;
}

describe('BootGuard', () => {
  it('accepts a token whose application is the configured one and is allowed', async () => {
    const get = vi.fn().mockResolvedValue({ id: APP_ID, username: 'bot' });
    await expect(guard({ rest: get }).assertIdentity()).resolves.toBe(APP_ID);
    expect(get).toHaveBeenCalledWith(Routes.user('@me'));
  });

  it('refuses a token that belongs to another application than DISCORD_CLIENT_ID', async () => {
    const error = await failureOf(
      guard({
        rest: vi.fn().mockResolvedValue({ id: OTHER_APP_ID }),
        allowed: [APP_ID, OTHER_APP_ID],
      }).assertIdentity(),
    );
    expect(error.message).toContain('DISCORD_CLIENT_ID');
    expect(error.message).toContain(OTHER_APP_ID);
    expect(error.message).not.toContain(token);
  });

  it('refuses an application that is configured but not in DISCORD_ALLOWED_APP_IDS', async () => {
    const error = await failureOf(
      guard({
        rest: vi.fn().mockResolvedValue({ id: APP_ID }),
        allowed: [OTHER_APP_ID],
      }).assertIdentity(),
    );
    expect(error.message).toContain('DISCORD_ALLOWED_APP_IDS');
    expect(error.message).toContain(APP_ID);
  });

  it('reports a rejected token by variable name without the library error text', async () => {
    const rejected = Object.assign(new Error(`401: Unauthorized ${token}`), { status: 401 });
    const error = await failureOf(
      guard({ rest: vi.fn().mockRejectedValue(rejected) }).assertIdentity(),
    );
    expect(error.message).toContain('DISCORD_TOKEN');
    expect(error.message).toContain('401');
    expect(error.message).not.toContain(token);
  });

  it('fails closed when Discord cannot be reached, naming only the error class', async () => {
    const unreachable = Object.assign(new Error(`connect ECONNREFUSED ${token}`), {
      code: 'ECONNREFUSED',
    });
    const error = await failureOf(
      guard({ rest: vi.fn().mockRejectedValue(unreachable) }).assertIdentity(),
    );
    expect(error.message).toContain('ECONNREFUSED');
    expect(error.message).not.toContain(token);
  });

  it('refuses an answer that is not a user', async () => {
    const error = await failureOf(
      guard({ rest: vi.fn().mockResolvedValue({ message: 'nope' }) }).assertIdentity(),
    );
    expect(error.message).toContain('unexpected');
  });
});
