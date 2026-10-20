import 'reflect-metadata';
import { QUEUES } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import { EMAIL_VERIFY_PURGE_CRON, EmailVerifyCron } from './email-verify.cron.js';
import type { EmailVerifyService } from './email-verify.service.js';

function build(
  purge: () => Promise<{ pending: number; sendDays: number }> = () =>
    Promise.resolve({ pending: 0, sendDays: 0 }),
) {
  const boss = {
    work: vi.fn((_queue: string, _options: object, _handler: () => Promise<void>) =>
      Promise.resolve('worker'),
    ),
    schedule: vi.fn(() => Promise.resolve()),
  };
  const verify = { purgeExpired: vi.fn(purge) };
  let queued: (() => void | Promise<void>) | undefined;
  const ready = {
    afterReady: vi.fn((_label: string, task: () => void | Promise<void>) => {
      queued = task;
    }),
  };
  const cron = new EmailVerifyCron(
    boss as unknown as PgBossService,
    ready as unknown as DiscordReadyService,
    verify as unknown as EmailVerifyService,
  );
  return {
    cron,
    boss,
    verify,
    ready,
    start: async () => {
      cron.onApplicationBootstrap();
      await queued?.();
    },
  };
}

describe('EmailVerifyCron', () => {
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
    expect(boss.work).toHaveBeenCalledWith(QUEUES.emailVerifyPurge, {}, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(
      QUEUES.emailVerifyPurge,
      EMAIL_VERIFY_PURGE_CRON,
      {},
    );
    expect(EMAIL_VERIFY_PURGE_CRON).toBe('30 3 * * *');
  });

  it('purges and logs only the counts', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { start, boss, verify } = build(() =>
        Promise.resolve({ pending: 3, sendDays: 2, throttles: 4 }),
      );
      await start();
      await boss.work.mock.calls[0]?.[2]();
      expect(verify.purgeExpired).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        'Email verification purge removed 3 pending, 2 send counter(s) and 4 member throttle(s)',
      );
    } finally {
      log.mockRestore();
    }
  });

  it('lets a failed purge fail the job so pg-boss retries it', async () => {
    const { start, boss } = build(() => Promise.reject(new Error('db down')));
    await start();
    await expect(boss.work.mock.calls[0]?.[2]()).rejects.toThrow('db down');
  });
});
