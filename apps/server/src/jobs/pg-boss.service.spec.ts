import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { QUEUES } from '@sab/shared';
import { PgBoss, type ConstructorOptions } from 'pg-boss';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { DEFAULT_CONNECT_RETRY, DatabaseConnectError } from '../prisma/pool-factory.js';
import { PgBossModule } from './pg-boss.module.js';
import {
  ERROR_LOG_WINDOW_MS,
  PGBOSS_CONNECT_RETRY,
  PGBOSS_SCHEMA,
  PgBossService,
  SCHEDULE_TIME_ZONE,
  STOP_TIMEOUT_MS,
  buildPgBossOptions,
} from './pg-boss.service.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

// Port 1 refuses at once, so nothing here waits on a network timeout.
const unreachable: ConstructorOptions = {
  connectionString: 'postgresql://u:p@127.0.0.1:1/db',
  schema: PGBOSS_SCHEMA,
  migrate: false,
  createSchema: false,
};
const fastRetry = { attempts: 3, baseDelayMs: 1 };

function envFor(password: string, overrides: Record<string, string> = {}): Record<string, string> {
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
    LOG_LEVEL: 'silent',
    ...overrides,
  };
}

describe('buildPgBossOptions', () => {
  it('sizes the pool from the environment, pins UTC and never installs the schema', () => {
    const options = buildPgBossOptions(envFor(marker('pw'), { PGBOSS_POOL_MAX: '3' }));
    expect(options).toMatchObject({
      max: 3,
      schema: PGBOSS_SCHEMA,
      options: '-c timezone=UTC',
      connectionTimeoutMillis: 5_000,
      migrate: false,
      createSchema: false,
    });
    expect(options.connectionString).toContain('127.0.0.1:1/sab');
  });

  it('defaults the pool to 4 connections', () => {
    expect(buildPgBossOptions(envFor(marker('pw'))).max).toBe(4);
  });
});

describe('PgBossModule', () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(envFor(marker('pw')))) vi.stubEnv(name, value);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('compiles without a database and resolves the service with its dependencies', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PgBossModule] }).compile();
    try {
      const service = moduleRef.get(PgBossService);
      expect(service).toBeInstanceOf(PgBossService);
      expect(service.boss).toBeInstanceOf(PgBoss);
      expect(Reflect.getMetadata('design:paramtypes', PgBossService)).toHaveLength(3);
      expect(moduleRef.get(PGBOSS_CONNECT_RETRY)).toEqual(DEFAULT_CONNECT_RETRY);
    } finally {
      await moduleRef.close();
    }
  });

  it('reads the worker switch from the environment', async () => {
    vi.stubEnv('PGBOSS_WORKERS_ENABLED', 'false');
    const moduleRef = await Test.createTestingModule({ imports: [PgBossModule] }).compile();
    try {
      const service = moduleRef.get(PgBossService);
      vi.spyOn(service.boss, 'createQueue').mockResolvedValue();
      const work = vi.spyOn(service.boss, 'work');
      vi.spyOn(service.boss, 'start').mockResolvedValue(service.boss);
      await service.onApplicationBootstrap();
      await expect(
        service.work(QUEUES.birthdayDaily, {}, () => Promise.resolve()),
      ).resolves.toBeNull();
      expect(work).not.toHaveBeenCalled();
    } finally {
      await moduleRef.close();
    }
  });

  it('cannot resolve a copy of the service whose parameters carry no injection token', async () => {
    @Injectable()
    class WithoutTokens {
      constructor(
        readonly options: ConstructorOptions,
        readonly workers: boolean,
        readonly retry: object,
      ) {}
    }
    await expect(
      Test.createTestingModule({ providers: [WithoutTokens] }).compile(),
    ).rejects.toThrow(/resolve dependencies/i);
  });
});

describe('PgBossService', () => {
  const quiet = () => undefined;
  let error: MockInstance<Logger['error']>;
  let warn: MockInstance<Logger['warn']>;

  beforeEach(() => {
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(quiet);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(quiet);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(quiet);
  });
  afterEach(() => vi.restoreAllMocks());

  const build = (workers = true) => new PgBossService(unreachable, workers, fastRetry);

  function started(service: PgBossService) {
    vi.spyOn(service.boss, 'start').mockResolvedValue(service.boss);
    return service.onApplicationBootstrap();
  }

  describe('error events', () => {
    it('keeps a listener on the instance, so a dropped connection cannot end the process', () => {
      const service = build();
      expect(service.boss.listenerCount('error')).toBeGreaterThan(0);
      expect(() => service.boss.emit('error', new Error('terminating connection'))).not.toThrow();

      // The same event on an instance without the listener is thrown.
      expect(() => new PgBoss(unreachable).emit('error', new Error('boom'))).toThrow('boom');
      service.boss.removeAllListeners('error');
      expect(() => service.boss.emit('error', new Error('boom'))).toThrow('boom');
    });

    it('logs the error name and code, never its message', () => {
      const service = build();
      const leaked = marker('driver-message');
      service.boss.emit('error', Object.assign(new Error(leaked), { code: 'ECONNRESET' }));
      expect(error).toHaveBeenCalledTimes(1);
      const line = String(error.mock.calls[0]?.[0]);
      expect(line).toContain('Error ECONNRESET');
      expect(line).not.toContain(leaked);
    });

    it('logs a burst once per window and reports how many were folded in', () => {
      const service = build();
      let now = 1_000_000;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
      for (let index = 0; index < 5; index++) service.boss.emit('error', new Error('x'));
      expect(error).toHaveBeenCalledTimes(1);

      now += ERROR_LOG_WINDOW_MS + 1;
      service.boss.emit('error', new Error('x'));
      expect(error).toHaveBeenCalledTimes(2);
      expect(String(error.mock.calls[1]?.[0])).toContain('(+4 similar)');
    });
  });

  describe('start', () => {
    it('settles `started` once a later attempt connects', async () => {
      const service = build();
      const start = vi
        .spyOn(service.boss, 'start')
        .mockRejectedValueOnce(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))
        .mockRejectedValueOnce(new Error('refused'))
        .mockResolvedValue(service.boss);
      await service.onApplicationBootstrap();
      await expect(service.started).resolves.toBeUndefined();
      expect(start).toHaveBeenCalledTimes(3);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it('gives up after the budget with the error name only, and rejects `started`', async () => {
      const leaked = marker('postgres-url');
      const service = new PgBossService(
        { ...unreachable, connectionString: `postgresql://u:${leaked}@127.0.0.1:1/db` },
        true,
        fastRetry,
      );
      vi.spyOn(service.boss, 'start').mockRejectedValue(
        Object.assign(new Error(`connect ECONNREFUSED ${leaked}`), { code: 'ECONNREFUSED' }),
      );
      const attempt = service.onApplicationBootstrap();
      await expect(attempt).rejects.toBeInstanceOf(DatabaseConnectError);
      await expect(attempt).rejects.not.toThrow(leaked);
      await expect(service.started).rejects.toBeInstanceOf(DatabaseConnectError);
      await expect(service.send(QUEUES.birthdayDaily, {}, { id: 'a' })).rejects.toBeInstanceOf(
        DatabaseConnectError,
      );
      for (const call of [...warn.mock.calls, ...error.mock.calls]) {
        expect(String(call[0])).not.toContain(leaked);
      }
    });

    it('reports a missing schema by a name that says what to do', async () => {
      const service = build();
      vi.spyOn(service.boss, 'start').mockRejectedValue(new Error('pg-boss is not installed'));
      await expect(service.onApplicationBootstrap()).rejects.toThrow('PgBossNotInstalled');

      const stale = build();
      vi.spyOn(stale.boss, 'start').mockRejectedValue(
        new Error('pg-boss database requires migrations'),
      );
      await expect(stale.onApplicationBootstrap()).rejects.toThrow('PgBossMigrationPending');
    });

    it('rejects the real start with a refused connection and does not hang', async () => {
      const service = build();
      await expect(service.onApplicationBootstrap()).rejects.toBeInstanceOf(DatabaseConnectError);
      await service.onModuleDestroy();
    });
  });

  describe('shutdown', () => {
    it('stops gracefully with the full timeout, and only once', async () => {
      const service = build();
      const stop = vi.spyOn(service.boss, 'stop').mockResolvedValue();
      await service.onModuleDestroy();
      await service.onModuleDestroy();
      expect(stop).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledWith({ graceful: true, timeout: STOP_TIMEOUT_MS });
      expect(STOP_TIMEOUT_MS).toBe(30_000);
    });

    it('does not throw when stop fails, so the pool still gets closed', async () => {
      const service = build();
      vi.spyOn(service.boss, 'stop').mockRejectedValue(new Error('x'));
      await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('queue operations', () => {
    it('registers a worker after creating the queue, once started', async () => {
      const service = build();
      const order: string[] = [];
      vi.spyOn(service.boss, 'createQueue').mockImplementation(() => {
        order.push('createQueue');
        return Promise.resolve();
      });
      vi.spyOn(service.boss, 'work').mockImplementation(() => {
        order.push('work');
        return Promise.resolve('worker-1');
      });
      const pending = service.work(QUEUES.scheduledMessageSend, {}, () => Promise.resolve());
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(order).toEqual([]);

      await started(service);
      await expect(pending).resolves.toBe('worker-1');
      expect(order).toEqual(['createQueue', 'work']);
    });

    it('creates each queue once and retries after a failed creation', async () => {
      const service = build();
      const createQueue = vi
        .spyOn(service.boss, 'createQueue')
        .mockRejectedValueOnce(new Error('x'))
        .mockResolvedValue();
      vi.spyOn(service.boss, 'send').mockResolvedValue('job');
      await started(service);
      await expect(service.send(QUEUES.birthdayDaily, {}, { id: 'a' })).rejects.toThrow();
      await service.send(QUEUES.birthdayDaily, {}, { id: 'b' });
      await service.send(QUEUES.birthdayDaily, {}, { id: 'c' });
      expect(createQueue).toHaveBeenCalledTimes(2);
    });

    it('sends with the row id as the job id and returns null for a duplicate', async () => {
      const service = build();
      vi.spyOn(service.boss, 'createQueue').mockResolvedValue();
      const send = vi
        .spyOn(service.boss, 'send')
        .mockResolvedValueOnce('row-id')
        .mockResolvedValue(null);
      await started(service);
      const startAfter = new Date('2026-10-13T00:00:00Z');
      await expect(
        service.send(QUEUES.scheduledMessageSend, { a: 1 }, { id: 'row-id', startAfter }),
      ).resolves.toBe('row-id');
      await expect(
        service.send(QUEUES.scheduledMessageSend, { a: 1 }, { id: 'row-id', startAfter }),
      ).resolves.toBeNull();
      expect(send).toHaveBeenCalledWith(
        QUEUES.scheduledMessageSend,
        { a: 1 },
        { id: 'row-id', startAfter },
      );
    });

    it('cancels by queue and id and returns the affected count', async () => {
      const service = build();
      const cancel = vi
        .spyOn(service.boss, 'cancel')
        .mockResolvedValue({ jobs: ['x'], requested: 1, affected: 0 });
      await started(service);
      await expect(service.cancel(QUEUES.scheduledMessageSend, 'x')).resolves.toBe(0);
      expect(cancel).toHaveBeenCalledWith(QUEUES.scheduledMessageSend, 'x');
    });

    it('schedules in the business time zone and sends one catch-up job for missed runs', async () => {
      const service = build();
      vi.spyOn(service.boss, 'createQueue').mockResolvedValue();
      const schedule = vi.spyOn(service.boss, 'schedule').mockResolvedValue();
      await started(service);
      await service.schedule(QUEUES.birthdayDaily, '0 0 * * *');
      expect(SCHEDULE_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
      expect(schedule).toHaveBeenCalledWith(
        QUEUES.birthdayDaily,
        '0 0 * * *',
        {},
        {
          tz: 'Asia/Ho_Chi_Minh',
          missed: 'once',
        },
      );
    });
  });
});
