import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_CONNECT_RETRY,
  DatabaseConnectError,
  POOL_CONNECTION_TIMEOUT_MS,
  POOL_IDLE_TIMEOUT_MS,
  UTC_SESSION_OPTIONS,
  connectWithRetry,
  createPool,
  errorLabel,
} from './pool-factory.js';
import { PrismaModule } from './prisma.module.js';
import { PRISMA_CONNECT_RETRY, PrismaService } from './prisma.service.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

// Port 1 refuses connections immediately, so the failure path runs for real
// without a database and without waiting on a timeout.
function unreachableDatabaseEnv(password: string): Record<string, string> {
  return {
    APP_ENV: 'production',
    DISCORD_TOKEN: marker('discord'),
    DISCORD_CLIENT_ID: '111111111111111111',
    DISCORD_ALLOWED_APP_IDS: '111111111111111111',
    DISCORD_DEV_GUILD_ID: '',
    ADMIN_GUILD_ID: '333333333333333333',
    POSTGRES_HOST: '127.0.0.1',
    POSTGRES_PORT: '1',
    POSTGRES_DB: 'sab',
    POSTGRES_USER: 'sab_app',
    POSTGRES_PASSWORD: password,
    DB_POOL_MAX: '3',
    LOG_LEVEL: 'silent',
  };
}

describe('createPool', () => {
  it('sets the size, both timeouts and the UTC session option on the pool', async () => {
    const pool = createPool('postgresql://u:p@127.0.0.1:1/db', 3);
    try {
      expect(pool.options).toMatchObject({
        max: 3,
        connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
        idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
        options: UTC_SESSION_OPTIONS,
      });
      expect(POOL_CONNECTION_TIMEOUT_MS).toBe(5_000);
      expect(UTC_SESSION_OPTIONS).toBe('-c timezone=UTC');
    } finally {
      await pool.end();
    }
  });

  it('survives an idle-client error and logs only its name and code', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const pool = createPool('postgresql://u:p@127.0.0.1:1/db', 1);
    try {
      expect(pool.listenerCount('error')).toBeGreaterThan(0);
      const leaked = marker('driver-message');
      pool.emit('error', Object.assign(new Error(leaked), { code: 'ECONNRESET' }));
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]?.[0]);
      expect(line).toContain('Error ECONNRESET');
      expect(line).not.toContain(leaked);
    } finally {
      await pool.end();
      error.mockRestore();
    }
  });
});

describe('errorLabel', () => {
  it('drops a code that is not a short identifier', () => {
    expect(errorLabel(Object.assign(new Error('x'), { code: 'host=db password=x' }))).toBe('Error');
    expect(errorLabel('not an error')).toBe('UnknownError');
  });
});

describe('connectWithRetry', () => {
  const policy = { attempts: 5, baseDelayMs: 1 };

  it('keeps the default budget at 5 attempts and 1, 2, 4, 8 s between them', () => {
    expect(DEFAULT_CONNECT_RETRY).toEqual({ attempts: 5, baseDelayMs: 1_000 });
    const waits = Array.from(
      { length: DEFAULT_CONNECT_RETRY.attempts - 1 },
      (_, index) => DEFAULT_CONNECT_RETRY.baseDelayMs * 2 ** index,
    );
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('returns once a later attempt succeeds and reports each failure before it', async () => {
    let calls = 0;
    const failures: Array<{ attempt: number; retryInMs: number | undefined }> = [];
    await connectWithRetry(
      () => {
        calls += 1;
        return calls < 3 ? Promise.reject(new Error('down')) : Promise.resolve();
      },
      policy,
      ({ attempt, retryInMs }) => failures.push({ attempt, retryInMs }),
    );
    expect(calls).toBe(3);
    expect(failures).toEqual([
      { attempt: 1, retryInMs: 1 },
      { attempt: 2, retryInMs: 2 },
    ]);
  });

  it('throws after the budget with the error name only, never the driver message', async () => {
    const leaked = marker('postgres-url');
    let calls = 0;
    const attempt = connectWithRetry(
      () => {
        calls += 1;
        return Promise.reject(Object.assign(new Error(leaked), { code: 'ECONNREFUSED' }));
      },
      policy,
      () => undefined,
    );
    await expect(attempt).rejects.toBeInstanceOf(DatabaseConnectError);
    await expect(attempt).rejects.toThrow('5 attempt(s)');
    await expect(attempt).rejects.not.toThrow(leaked);
    expect(calls).toBe(5);
  });
});

describe('PrismaService', () => {
  let moduleRef: TestingModule | undefined;
  let password: string;
  const quiet = () => undefined;

  beforeEach(() => {
    password = marker('postgres');
    for (const [name, value] of Object.entries(unreachableDatabaseEnv(password))) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves through the container with the default retry budget', async () => {
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    const service = moduleRef.get(PrismaService);
    // PrismaClient's constructor returns a Proxy, so `instanceof` is false and a
    // failed assertion would try to print the client and recurse without end:
    // assert on plain booleans instead.
    expect(service === undefined).toBe(false);
    expect(typeof service.onModuleInit).toBe('function');
    expect(service['retry']).toEqual(DEFAULT_CONNECT_RETRY);
  });

  it('takes the retry budget from the container when one is provided', async () => {
    const budget = { attempts: 2, baseDelayMs: 1 };
    moduleRef = await Test.createTestingModule({
      providers: [PrismaService, { provide: PRISMA_CONNECT_RETRY, useValue: budget }],
    }).compile();
    expect(moduleRef.get(PrismaService)['retry']).toBe(budget);
  });

  it('gives up after its budget when the database is unreachable, without leaking credentials', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(quiet);
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        { provide: PRISMA_CONNECT_RETRY, useValue: { attempts: 3, baseDelayMs: 1 } },
      ],
    }).compile();

    const failure = await moduleRef.init().then(
      () => undefined,
      (error: unknown) => error,
    );
    // Nest awaits its init promise again in close(), which would rethrow this
    // failure; shut the service down directly instead.
    const service = moduleRef.get(PrismaService);
    moduleRef = undefined;
    await service.onApplicationShutdown();
    expect(failure).toBeInstanceOf(DatabaseConnectError);
    const message = (failure as DatabaseConnectError).message;
    expect(message).toContain('3 attempt(s)');
    expect(message).not.toContain(password);
    expect(message).not.toContain('127.0.0.1');

    const lines = warn.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.startsWith('Database connect attempt'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/attempt 1 failed .*retrying in 1 ms/);
    expect(lines[2]).toMatch(/attempt 3 failed .*giving up/);
    for (const line of lines) {
      expect(line).not.toContain(password);
      expect(line).not.toContain('127.0.0.1');
    }
  });

  it('closes in onApplicationShutdown only, and a second shutdown does not throw', async () => {
    expect('onModuleDestroy' in PrismaService.prototype).toBe(false);
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(quiet);
    moduleRef = await Test.createTestingModule({ imports: [PrismaModule] }).compile();
    const service = moduleRef.get(PrismaService);

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalled();

    await expect(service.onApplicationShutdown()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Postgres pool close failed'));
  });
});
