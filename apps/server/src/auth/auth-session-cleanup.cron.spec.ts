import 'reflect-metadata';
import { QUEUES } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../discord/discord-ready.service.js';
import type { PgBossService } from '../jobs/pg-boss.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AUTH_SESSION_CLEANUP_CRON, AuthSessionCleanupCron } from './auth-session-cleanup.cron.js';

function build(deleteMany: () => Promise<{ count: number }> = () => Promise.resolve({ count: 0 })) {
  const boss = {
    work: vi.fn((_queue: string, _options: object, _handler: () => Promise<void>) =>
      Promise.resolve('worker'),
    ),
    schedule: vi.fn(() => Promise.resolve()),
  };
  const prisma = {
    session: { deleteMany: vi.fn(deleteMany) },
    verification: { deleteMany: vi.fn(() => Promise.resolve({ count: 2 })) },
  };
  let queued: (() => void | Promise<void>) | undefined;
  const ready = {
    afterReady: vi.fn((_label: string, task: () => void | Promise<void>) => {
      queued = task;
    }),
  };
  const cron = new AuthSessionCleanupCron(
    boss as unknown as PgBossService,
    ready as unknown as DiscordReadyService,
    prisma as unknown as PrismaService,
  );
  return {
    cron,
    boss,
    prisma,
    ready,
    start: async () => {
      cron.onApplicationBootstrap();
      await queued?.();
    },
  };
}

describe('AuthSessionCleanupCron', () => {
  it('registers nothing before Discord is ready', () => {
    const { cron, ready, boss } = build();
    cron.onApplicationBootstrap();
    expect(ready.afterReady).toHaveBeenCalledTimes(1);
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('once ready, registers the worker and the daily schedule', async () => {
    const { start, boss } = build();
    await start();
    expect(boss.work).toHaveBeenCalledWith(QUEUES.authSessionCleanup, {}, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(
      QUEUES.authSessionCleanup,
      AUTH_SESSION_CLEANUP_CRON,
      {},
    );
    expect(AUTH_SESSION_CLEANUP_CRON).toBe('45 3 * * *');
  });

  it('deletes the sessions that expired before now and logs only the count', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { start, boss, prisma } = build(() => Promise.resolve({ count: 4 }));
      await start();
      const before = Date.now();
      await boss.work.mock.calls[0]?.[2]();
      const where = (
        prisma.session.deleteMany.mock.calls[0] as unknown as [
          { where: { expiresAt: { lt: Date } } },
        ]
      )[0].where;
      expect(where.expiresAt.lt.getTime()).toBeGreaterThanOrEqual(before);
      expect(prisma.verification.deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: where.expiresAt.lt } },
      });
      expect(log).toHaveBeenCalledWith(
        'Session cleanup removed 4 expired session(s) and 2 verification(s)',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('lets a failed delete fail the job so pg-boss retries it', async () => {
    const { start, boss } = build(() => Promise.reject(new Error('db down')));
    await start();
    await expect(boss.work.mock.calls[0]?.[2]()).rejects.toThrow('db down');
  });
});
