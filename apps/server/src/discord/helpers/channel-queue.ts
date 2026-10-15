import pLimit, { type LimitFunction } from 'p-limit';

/**
 * One queue per channel, so the moves of a channel game are judged in the
 * order Discord delivered them. Handlers run concurrently, so without it a
 * later message whose database round-trip happens to finish first takes the
 * move, and the player who sent first is refused against a move sent after
 * theirs. Only judging belongs in the queue: reactions and replies run
 * outside, so a slow reply never holds up the next move. In process only,
 * which is enough because one process serves the token.
 */
export class ChannelQueue {
  private readonly queues = new Map<string, LimitFunction>();

  /**
   * @param timeoutMs Longest a task may hold its channel's queue. The pool has
   *   no query timeout, so a stalled connection would otherwise freeze the game
   *   in that channel; past this the next task runs, and the database still
   *   refuses a stale move.
   * @param label Names the task in the timeout error, e.g. "Judging a word".
   */
  constructor(
    private readonly timeoutMs: number,
    private readonly label: string,
  ) {}

  /**
   * Runs `task` after every earlier task of the channel, giving up on it after
   * the timeout. The queue is joined before the caller's own first `await`
   * returns; every message passes through the same Necord wrapping before
   * that, so the order is the order Discord delivered them in as long as no
   * async guard or pipe is added to the listener class. An empty queue is
   * dropped.
   */
  async run<T>(channelId: string, task: () => Promise<T>): Promise<T> {
    let queue = this.queues.get(channelId);
    if (queue === undefined) {
      queue = pLimit(1);
      this.queues.set(channelId, queue);
    }
    try {
      return await queue(() => withTimeout(task(), this.timeoutMs, this.label));
    } finally {
      if (queue.activeCount === 0 && queue.pendingCount === 0) {
        this.queues.delete(channelId);
      }
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
