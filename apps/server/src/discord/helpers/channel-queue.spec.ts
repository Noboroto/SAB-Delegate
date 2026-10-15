import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChannelQueue } from './channel-queue.js';

const CHANNEL = '200000000000000001';
const OTHER = '200000000000000002';

afterEach(() => {
  vi.useRealTimers();
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const queuesOf = (queue: ChannelQueue) =>
  (queue as unknown as { queues: Map<string, unknown> }).queues;

describe('ChannelQueue', () => {
  it('runs the tasks of a channel in the order they were queued, however long each takes', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    const order: string[] = [];
    const task = (name: string, ms: number) => async () => {
      await sleep(ms);
      order.push(name);
      return name;
    };
    const results = await Promise.all([
      queue.run(CHANNEL, task('first', 20)),
      queue.run(CHANNEL, task('second', 0)),
      queue.run(CHANNEL, task('third', 5)),
    ]);
    expect(order).toEqual(['first', 'second', 'third']);
    expect(results).toEqual(['first', 'second', 'third']);
  });

  it('never runs two tasks of one channel at once', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    let running = 0;
    let peak = 0;
    const task = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await sleep(2);
      running -= 1;
    };
    await Promise.all(Array.from({ length: 6 }, () => queue.run(CHANNEL, task)));
    expect(peak).toBe(1);
  });

  it('lets different channels run side by side', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    const order: string[] = [];
    await Promise.all([
      queue.run(CHANNEL, async () => {
        await sleep(20);
        order.push('slow');
      }),
      queue.run(OTHER, () => {
        order.push('fast');
        return Promise.resolve();
      }),
    ]);
    expect(order).toEqual(['fast', 'slow']);
  });

  it('drops the queue of a channel once it is empty', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    await Promise.all([
      queue.run(CHANNEL, () => Promise.resolve(1)),
      queue.run(CHANNEL, () => Promise.resolve(2)),
      queue.run(OTHER, () => Promise.resolve(3)),
    ]);
    expect(queuesOf(queue).size).toBe(0);
  });

  it('keeps the queue while a task is still waiting', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    const first = queue.run(CHANNEL, () => sleep(10));
    const second = queue.run(CHANNEL, () => sleep(10));
    await first;
    expect(queuesOf(queue).size).toBe(1);
    await second;
    expect(queuesOf(queue).size).toBe(0);
  });

  it('passes a failure to its caller, runs the next task and still drops the queue', async () => {
    const queue = new ChannelQueue(1_000, 'Judging');
    const failing = queue.run(CHANNEL, () => Promise.reject(new Error('boom')));
    const next = queue.run(CHANNEL, () => Promise.resolve('ok'));
    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
    expect(queuesOf(queue).size).toBe(0);
  });

  it('gives up on a stuck task after the timeout, names it, and runs the next one', async () => {
    vi.useFakeTimers();
    const queue = new ChannelQueue(10_000, 'Judging a game move');
    const stuck = queue.run(CHANNEL, () => new Promise<never>(() => undefined));
    const stuckSettled = expect(stuck).rejects.toThrow('Judging a game move timed out');
    const next = queue.run(CHANNEL, () => Promise.resolve('after'));

    await vi.advanceTimersByTimeAsync(9_999);
    let nextDone = false;
    void next.then(() => {
      nextDone = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(nextDone).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await stuckSettled;
    await expect(next).resolves.toBe('after');
    expect(queuesOf(queue).size).toBe(0);
  });

  it('does not time out a task that finishes in time, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const queue = new ChannelQueue(10_000, 'Judging');
    const done = queue.run(CHANNEL, async () => {
      await sleep(100);
      return 'fine';
    });
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBe('fine');
    expect(vi.getTimerCount()).toBe(0);
  });
});
