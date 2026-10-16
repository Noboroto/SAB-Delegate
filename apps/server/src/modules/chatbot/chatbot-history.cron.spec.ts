import 'reflect-metadata';
import { CHATBOT_HISTORY_RETENTION_DAYS, QUEUES } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import { CHATBOT_HISTORY_RETENTION_CRON, ChatbotHistoryCron } from './chatbot-history.cron.js';
import type { ChatbotHistoryService } from './chatbot-history.service.js';

function build(purge: () => Promise<number> = () => Promise.resolve(0)) {
  const boss = {
    work: vi.fn((_queue: string, _options: object, _handler: () => Promise<void>) =>
      Promise.resolve('worker'),
    ),
    schedule: vi.fn(() => Promise.resolve()),
  };
  const history = { purgeOlderThan: vi.fn(purge) };
  let queued: (() => void | Promise<void>) | undefined;
  const ready = {
    afterReady: vi.fn((_label: string, task: () => void | Promise<void>) => {
      queued = task;
    }),
  };
  const cron = new ChatbotHistoryCron(
    boss as unknown as PgBossService,
    ready as unknown as DiscordReadyService,
    history as unknown as ChatbotHistoryService,
  );
  return {
    cron,
    boss,
    history,
    ready,
    start: async () => {
      cron.onApplicationBootstrap();
      await queued?.();
    },
  };
}

describe('ChatbotHistoryCron', () => {
  it('registers nothing before Discord is ready', () => {
    const { cron, ready, boss } = build();
    cron.onApplicationBootstrap();
    expect(ready.afterReady).toHaveBeenCalledTimes(1);
    expect(boss.work).not.toHaveBeenCalled();
    expect(boss.schedule).not.toHaveBeenCalled();
  });

  it('once ready, registers the worker and the daily schedule', async () => {
    const { start, boss, ready } = build();
    await start();
    expect(ready.afterReady).toHaveBeenCalledWith(
      'chatbot-history-retention',
      expect.any(Function),
    );
    expect(boss.work).toHaveBeenCalledWith(
      QUEUES.chatbotHistoryRetention,
      {},
      expect.any(Function),
    );
    expect(boss.schedule).toHaveBeenCalledWith(
      QUEUES.chatbotHistoryRetention,
      CHATBOT_HISTORY_RETENTION_CRON,
      {},
    );
  });

  it('schedules a five-field cron for 03:15', () => {
    expect(CHATBOT_HISTORY_RETENTION_CRON).toBe('15 3 * * *');
  });

  it('purges with the retention window when the job runs', async () => {
    const { start, boss, history } = build();
    await start();
    await boss.work.mock.calls[0]?.[2]();
    expect(history.purgeOlderThan).toHaveBeenCalledWith(CHATBOT_HISTORY_RETENTION_DAYS);
  });

  it('logs how many turns it deleted, and nothing else about them', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      const { start, boss } = build(() => Promise.resolve(12));
      await start();
      await boss.work.mock.calls[0]?.[2]();
      expect(log).toHaveBeenCalledWith('Chatbot history retention deleted 12 turn(s)');
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
