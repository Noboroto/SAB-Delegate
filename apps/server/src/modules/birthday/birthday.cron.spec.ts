import 'reflect-metadata';
import { QUEUES } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import { BIRTHDAY_CRON, BirthdayCron } from './birthday.cron.js';
import type { BirthdayService } from './birthday.service.js';

const quiet = { guilds: 0, sent: 0, failed: 0, retryAt: null };

function build(
  options: {
    daily?: () => Promise<unknown>;
    recover?: () => Promise<unknown>;
  } = {},
) {
  const calls: string[] = [];
  const boss = {
    work: vi.fn((_queue: string, _options: object, _handler: () => Promise<void>) => {
      calls.push('work');
      return Promise.resolve('worker');
    }),
    schedule: vi.fn(() => {
      calls.push('schedule');
      return Promise.resolve();
    }),
  };
  const birthdays = {
    runDailyWishes: vi.fn(
      options.daily ??
        (() => {
          calls.push('run');
          return Promise.resolve(quiet);
        }),
    ),
    recoverStaleRuns: vi.fn(options.recover ?? (() => Promise.resolve(quiet))),
  };
  let queued: (() => void | Promise<void>) | undefined;
  const ready = {
    afterReady: vi.fn((_label: string, task: () => void | Promise<void>) => {
      queued = task;
    }),
  };
  const cron = new BirthdayCron(
    boss as unknown as PgBossService,
    ready as unknown as DiscordReadyService,
    birthdays as unknown as BirthdayService,
  );
  return {
    cron,
    boss,
    birthdays,
    ready,
    calls,
    start: async () => {
      cron.onApplicationBootstrap();
      await queued?.();
    },
    handler: () => boss.work.mock.calls[0]?.[2],
  };
}

describe('BirthdayCron', () => {
  it('registers nothing before Discord is ready', () => {
    const { cron, ready, boss } = build();
    cron.onApplicationBootstrap();
    expect(ready.afterReady).toHaveBeenCalledWith('birthday-daily', expect.any(Function));
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('once ready, registers the worker, the midnight schedule, then catches up', async () => {
    const { start, boss, calls } = build();
    await start();
    expect(boss.work).toHaveBeenCalledWith(QUEUES.birthdayDaily, {}, expect.any(Function));
    expect(boss.schedule).toHaveBeenCalledWith(QUEUES.birthdayDaily, BIRTHDAY_CRON, {});
    expect(calls).toEqual(['work', 'schedule', 'run']);
  });

  it('schedules a five-field cron for midnight', () => {
    expect(BIRTHDAY_CRON).toBe('0 0 * * *');
    expect(BIRTHDAY_CRON.split(' ')).toHaveLength(5);
  });

  it('greets the business-zone day of the moment it runs', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-03-01T17:00:30Z'));
      const { start, birthdays } = build();
      await start();
      expect(birthdays.runDailyWishes).toHaveBeenCalledWith({ year: 2026, month: 3, day: 2 });
      expect(birthdays.recoverStaleRuns).toHaveBeenCalledWith({ year: 2026, month: 3, day: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('makes the job fail, so pg-boss retries it, when a server failed', async () => {
    const { start, handler } = build({
      daily: () => Promise.resolve({ ...quiet, failed: 1, retryAt: null }),
    });
    await start();
    await expect(handler()?.()).rejects.toThrow('failed for 1 server');
  });

  it('lets the job succeed when everything went out', async () => {
    const { start, handler } = build();
    await start();
    await expect(handler()?.()).resolves.toBeUndefined();
  });

  describe('follow-up', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('looks again after a lease somebody else holds lapses', async () => {
      const daily = vi
        .fn()
        .mockResolvedValueOnce({ ...quiet, retryAt: new Date(Date.now() + 60_000) })
        .mockResolvedValue(quiet);
      const { start } = build({ daily });
      await start();
      expect(daily).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(daily).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(40_000);
      expect(daily).toHaveBeenCalledTimes(2);
    });

    it('gives up after a few rounds instead of polling forever', async () => {
      const daily = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve({ ...quiet, failed: 1, retryAt: new Date(Date.now() + 1000) }),
        );
      const { start } = build({ daily });
      await start();
      await vi.advanceTimersByTimeAsync(60 * 60_000);
      // The first attempt plus five follow-ups.
      expect(daily).toHaveBeenCalledTimes(6);
    });

    it('cancels a pending look-again at shutdown', async () => {
      const daily = vi.fn().mockResolvedValue({ ...quiet, retryAt: new Date(Date.now() + 1000) });
      const { start, cron } = build({ daily });
      await start();
      cron.onModuleDestroy();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(daily).toHaveBeenCalledTimes(1);
    });
  });
});
