import { ErrorCode } from '@sab/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../common/errors/http-error.js';
import { ServiceError } from '../common/errors/service-error.js';
import { loadEnv } from '../config/env.js';
import {
  describeError,
  describeTarget,
  guarded,
  mcpTargetFromEnv,
  ok,
  refuseUnconfirmed,
} from './tool-result.js';

const target = { host: 'bot.example.test', env: 'production' };
const guild = { id: '444444444444444441', name: 'Study Group' };

describe('mcpTargetFromEnv', () => {
  it('takes the host and environment from the validated configuration', () => {
    const env = loadEnv({
      APP_ENV: 'development',
      DISCORD_TOKEN: 'x',
      DISCORD_CLIENT_ID: '111111111111111111',
      DISCORD_ALLOWED_APP_IDS: '111111111111111111',
      DISCORD_DEV_GUILD_ID: '444444444444444444',
      ADMIN_GUILD_ID: '333333333333333333',
      POSTGRES_DB: 'sab',
      POSTGRES_USER: 'u',
      POSTGRES_PASSWORD: 'p',
      APP_URL: 'http://localhost:3450',
      DISCORD_CLIENT_SECRET: 's',
      BETTER_AUTH_SECRET: 'z'.repeat(32),
    });
    expect(mcpTargetFromEnv(env)).toEqual({ host: 'localhost:3450', env: 'development' });
  });
});

describe('describeError', () => {
  it('renders a service error from the catalog with its code', () => {
    expect(describeError(new ServiceError(ErrorCode.GUILD_NOT_FOUND))).toContain(
      '(GUILD_NOT_FOUND)',
    );
    expect(describeError(new ApiError(ErrorCode.RATE_LIMITED))).toContain('(RATE_LIMITED)');
  });

  it('reports a server the bot is missing from as the same not-found', () => {
    expect(describeError(new ServiceError(ErrorCode.GUILD_BOT_MISSING))).toBe(
      describeError(new ServiceError(ErrorCode.GUILD_NOT_FOUND)),
    );
  });

  it('hides everything else behind the internal error', () => {
    const text = describeError(new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'));
    expect(text).toContain('(INTERNAL)');
    expect(text).not.toContain('10.0.0.5');
    expect(text).not.toContain('hunter2');
    expect(describeError('a string')).toContain('(INTERNAL)');
  });
});

describe('guarded', () => {
  it('returns a tool error instead of throwing', async () => {
    const result = await guarded(() =>
      Promise.reject(new ServiceError(ErrorCode.VALIDATION_FAILED)),
    );
    expect(result.isError).toBe(true);
  });
});

describe('refuseUnconfirmed', () => {
  it('names the deployment, the server and the way forward', () => {
    const text = refuseUnconfirmed(target, guild, 'post a message').content[0]?.text ?? '';
    expect(text).toContain(
      'bot.example.test [production], server "Study Group" (444444444444444441)',
    );
    expect(text).toContain('post a message');
    expect(text).toContain('dryRun');
  });
});

describe('ok with a target', () => {
  it('puts the deployment and server beside the data', () => {
    const body = JSON.parse(ok({ a: 1 }, { target, guild }).content[0]?.text ?? '') as unknown;
    expect(body).toEqual({ deployment: 'bot.example.test [production]', guild, data: { a: 1 } });
    expect(describeTarget(target)).toBe('bot.example.test [production]');
  });
});
