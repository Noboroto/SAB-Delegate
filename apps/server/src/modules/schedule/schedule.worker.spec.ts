import 'reflect-metadata';
import { QUEUES } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { PgBossService } from '../../jobs/pg-boss.service.js';
import {
  REGISTER_ATTEMPTS,
  SCHEDULE_RECONCILE_INTERVAL_MS,
  ScheduleWorker,
} from './schedule.worker.js';
import type { ScheduleService } from './schedule.service.js';

const ID = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

type Handler = (jobs: Array<{ id: string; data: unknown }>) => Promise<void>;

function build(
  options: { workerId?: string | null; stopping?: boolean; workersEnabled?: boolean } = {},
) {
  let handler: Handler | undefined;
  const queued: Array<{ label: string; task: () => Promise<void> | void }> = [];
  const boss = {
    workersEnabled: options.workersEnabled ?? true,
    work: vi.fn((_queue: string, _options: object, fn: Handler) => {
      handler = fn;
      return Promise.resolve(options.workerId === undefined ? 'worker-1' : options.workerId);
    }),
  };
  const ready = {
    afterReady: vi.fn((label: string, task: () => Promise<void> | void) => {
      queued.push({ label, task });
    }),
    isStopping: vi.fn(() => options.stopping === true),
  };
  const schedules = {
    handleJob: vi.fn().mockResolvedValue(true),
    reconcilePending: vi.fn().mockResolvedValue({ handled: 0, enqueued: 0 }),
  };
  const worker = new ScheduleWorker(
    boss as unknown as PgBossService,
    ready as unknown as DiscordReadyService,
    schedules as unknown as ScheduleService,
  );
  return {
    worker,
    boss,
    ready,
    schedules,
    queued,
    runQueued: () => queued[0]?.task(),
    handler: () => handler,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('ScheduleWorker', () => {
  it('registers nothing until Discord is ready', () => {
    const { worker, boss, queued } = build();
    worker.onApplicationBootstrap();
    expect(queued.map((task) => task.label)).toEqual(['schedule-worker']);
    expect(boss.work).not.toHaveBeenCalled();
  });

  it('registers the queue worker and reconciles once when it starts', async () => {
    const { worker, boss, schedules, runQueued } = build();
    worker.onApplicationBootstrap();
    await runQueued();

    expect(boss.work).toHaveBeenCalledWith(QUEUES.scheduledMessageSend, {}, expect.any(Function));
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });

  it('runs a job through the service', async () => {
    const { worker, schedules, runQueued, handler } = build();
    worker.onApplicationBootstrap();
    await runQueued();
    await handler()?.([{ id: ID, data: { scheduleId: ID } }]);

    expect(schedules.handleJob).toHaveBeenCalledWith(ID);
    worker.onModuleDestroy();
  });

  it('lets a failed send reach pg-boss, which is what retries the job', async () => {
    const { worker, schedules, runQueued, handler } = build();
    schedules.handleJob.mockRejectedValueOnce(new Error('Discord is down'));
    worker.onApplicationBootstrap();
    await runQueued();

    await expect(handler()?.([{ id: ID, data: { scheduleId: ID } }])).rejects.toThrow(
      'Discord is down',
    );
    worker.onModuleDestroy();
  });

  it('drops a job with malformed data instead of retrying it', async () => {
    const { worker, schedules, runQueued, handler } = build();
    worker.onApplicationBootstrap();
    await runQueued();

    for (const data of [null, {}, { scheduleId: 'nope' }, { scheduleId: 42 }]) {
      await expect(handler()?.([{ id: ID, data }])).resolves.toBeUndefined();
    }
    expect(schedules.handleJob).not.toHaveBeenCalled();
    worker.onModuleDestroy();
  });

  it('neither sends nor reconciles when workers are off in this process', async () => {
    const { worker, boss, schedules, runQueued } = build({
      workerId: null,
      workersEnabled: false,
    });
    worker.onApplicationBootstrap();
    await runQueued();

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 3);
    expect(boss.work).not.toHaveBeenCalled();
    expect(schedules.reconcilePending).not.toHaveBeenCalled();
  });

  it('stops sweeping when the queue declines the consumer', async () => {
    const { worker, schedules, runQueued } = build({ workerId: null });
    worker.onApplicationBootstrap();
    await runQueued();

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 3);
    expect(schedules.reconcilePending).not.toHaveBeenCalled();
  });

  it('retries registering the consumer with a growing wait, and sweeps meanwhile', async () => {
    const { worker, boss, schedules, runQueued } = build();
    boss.work
      .mockRejectedValueOnce(new Error('queue unreachable'))
      .mockRejectedValueOnce(new Error('queue unreachable'));
    worker.onApplicationBootstrap();
    const starting = runQueued();

    await vi.advanceTimersByTimeAsync(0);
    expect(boss.work).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boss.work).toHaveBeenCalledTimes(2);
    // The second wait is longer than the first.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boss.work).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(boss.work).toHaveBeenCalledTimes(3);
    await starting;

    expect(schedules.reconcilePending).toHaveBeenCalledTimes(1);
    worker.onModuleDestroy();
  });

  it('sweeps overdue messages even when no consumer could be registered', async () => {
    const { worker, boss, schedules, runQueued } = build();
    boss.work.mockRejectedValue(new Error('queue unreachable'));
    worker.onApplicationBootstrap();
    const starting = runQueued();

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(1);

    // Bounded: 5 + 10 + 20 + 40 seconds of waiting, then it gives up.
    await vi.advanceTimersByTimeAsync(60_000);
    await starting;
    expect(boss.work).toHaveBeenCalledTimes(REGISTER_ATTEMPTS);
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 3);
    expect(boss.work).toHaveBeenCalledTimes(REGISTER_ATTEMPTS);
    expect(schedules.reconcilePending.mock.calls.length).toBeGreaterThanOrEqual(3);
    worker.onModuleDestroy();
  });

  it('stops retrying once the module is destroyed', async () => {
    const { worker, boss, runQueued } = build();
    boss.work.mockRejectedValue(new Error('queue unreachable'));
    worker.onApplicationBootstrap();
    const starting = runQueued();
    await vi.advanceTimersByTimeAsync(0);

    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    await starting;
    expect(boss.work).toHaveBeenCalledTimes(1);
  });

  it('reconciles again every interval and stops when the module is destroyed', async () => {
    const { worker, schedules, runQueued } = build();
    worker.onApplicationBootstrap();
    await runQueued();
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(3);

    worker.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 3);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(3);
  });

  it('does not start a pass while the previous one is still running', async () => {
    const { worker, schedules, runQueued } = build();
    let finish: (value: { handled: number; enqueued: number }) => void = () => undefined;
    schedules.reconcilePending
      .mockResolvedValueOnce({ handled: 0, enqueued: 0 })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    worker.onApplicationBootstrap();
    await runQueued();

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 2);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(2);

    finish({ handled: 0, enqueued: 0 });
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(3);
    worker.onModuleDestroy();
  });

  it('survives a failing pass and tries again at the next interval', async () => {
    const { worker, schedules, runQueued } = build();
    schedules.reconcilePending
      .mockResolvedValueOnce({ handled: 0, enqueued: 0 })
      .mockRejectedValueOnce(new Error('database is down'));
    worker.onApplicationBootstrap();
    await runQueued();

    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS);
    expect(schedules.reconcilePending).toHaveBeenCalledTimes(3);
    worker.onModuleDestroy();
  });

  it('does not reconcile once shutdown began', async () => {
    const { worker, schedules, runQueued } = build({ stopping: true });
    worker.onApplicationBootstrap();
    await runQueued();
    await vi.advanceTimersByTimeAsync(SCHEDULE_RECONCILE_INTERVAL_MS * 2);
    expect(schedules.reconcilePending).not.toHaveBeenCalled();
    worker.onModuleDestroy();
  });
});
