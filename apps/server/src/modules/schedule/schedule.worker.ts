import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { QUEUES } from '@sab/shared';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { PgBossService } from '../../jobs/pg-boss.service.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ScheduleJobDataSchema, ScheduleService } from './schedule.service.js';

/**
 * How often the table is compared with the queue while the bot runs. It is the
 * safety net for a job that never fires (lost, expired, or never queued
 * because the queue was unreachable when the message was scheduled): the cost
 * is one indexed read, and the worst delay such a message sees is this long
 * plus the overdue grace.
 */
export const SCHEDULE_RECONCILE_INTERVAL_MS = 60_000;

/** Tries to register the consumer, with waits of 5 s, 10 s, 20 s, 40 s between them. */
export const REGISTER_ATTEMPTS = 5;
const REGISTER_RETRY_BASE_MS = 5_000;

/**
 * Registers the pg-boss worker for scheduled messages and keeps the queue in
 * line with the table. Everything starts after Discord is ready: a worker that
 * took a job before the client could send would fail it for nothing.
 */
@Injectable()
export class ScheduleWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ScheduleWorker.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private destroyed = false;

  constructor(
    private readonly boss: PgBossService,
    private readonly ready: DiscordReadyService,
    private readonly schedules: ScheduleService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('schedule-worker', () => this.start());
  }

  onModuleDestroy(): void {
    this.destroyed = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async start(): Promise<void> {
    // Workers are off in this process (another one consumes the queue): it must not send either.
    if (!this.boss.workersEnabled) {
      this.logger.warn('Workers disabled: scheduled messages are left to another process');
      return;
    }
    // The sweep starts first: overdue rows are sent even while the queue is
    // unreachable and no consumer could be registered.
    this.timer = setInterval(() => void this.reconcile(), SCHEDULE_RECONCILE_INTERVAL_MS);
    // A pending pass must not keep the process alive at shutdown.
    this.timer.unref();

    if (await this.register()) await this.reconcile();
  }

  /**
   * Registers the consumer, retrying a bounded number of times with a growing
   * wait: the queue is created here, and the database can be briefly
   * unreachable at boot. True when a consumer is registered.
   */
  private async register(): Promise<boolean> {
    for (let attempt = 1; attempt <= REGISTER_ATTEMPTS; attempt += 1) {
      try {
        const workerId = await this.boss.work(QUEUES.scheduledMessageSend, {}, (jobs) =>
          this.handle(jobs),
        );
        if (workerId === null) {
          clearInterval(this.timer);
          this.timer = undefined;
          return false;
        }
        return true;
      } catch (error) {
        const retryInMs = REGISTER_RETRY_BASE_MS * 2 ** (attempt - 1);
        const last = attempt === REGISTER_ATTEMPTS;
        this.logger[last ? 'error' : 'warn'](
          `Registering the scheduled-message worker failed (${errorLabel(error)}); ${
            last ? 'giving up, overdue messages are still swept' : `retrying in ${retryInMs} ms`
          }`,
        );
        if (last || !(await this.pause(retryInMs))) return false;
      }
    }
    return false;
  }

  private async handle(jobs: ReadonlyArray<{ id: string; data: unknown }>): Promise<void> {
    for (const job of jobs) {
      const data = ScheduleJobDataSchema.safeParse(job.data);
      if (!data.success) {
        // Retrying cannot make a malformed job valid; the table is the truth and reconcile covers the row.
        this.logger.error(`Dropping scheduled-message job ${job.id}: malformed data`);
        continue;
      }
      // Throws when the send should be retried, which is what makes pg-boss run the job again.
      await this.schedules.handleJob(data.data.scheduleId);
    }
  }

  /** Waits; false when the module was destroyed or shutdown began meanwhile. */
  private async pause(ms: number): Promise<boolean> {
    await new Promise<void>((resolve) => {
      const wait = setTimeout(resolve, ms);
      wait.unref();
    });
    return !this.destroyed && !this.ready.isStopping();
  }

  /** One pass at a time; a pass that outlasts the interval is not started over. */
  private async reconcile(): Promise<void> {
    if (this.running || this.ready.isStopping()) return;
    this.running = true;
    try {
      const { handled, enqueued } = await this.schedules.reconcilePending();
      if (handled > 0 || enqueued > 0) {
        this.logger.log(`Reconciled scheduled messages: ${handled} sent, ${enqueued} queued`);
      }
    } catch (error) {
      this.logger.error(`Reconciling scheduled messages failed (${errorLabel(error)})`);
    } finally {
      this.running = false;
    }
  }
}
