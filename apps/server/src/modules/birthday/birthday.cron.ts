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
import { businessDayOf } from './birthday.date.js';
import { BirthdayService, type BirthdayRunSummary } from './birthday.service.js';

/** Midnight every day, read in the business time zone by `PgBossService.schedule`. */
export const BIRTHDAY_CRON = '0 0 * * *';

/** A day's leftovers are chased this many times in one process before leaving them to the next start. */
const MAX_FOLLOW_UPS = 5;

/** Never poll faster than this, whatever the lease says. */
const MIN_FOLLOW_UP_MS = 1000;

/**
 * Runs the daily greeting. pg-boss fires the job at 00:00 in the business time
 * zone and, if the process was down then, once more on the next start; checking
 * the schedule can also lag by up to 30 s. So the greeting is also attempted as
 * soon as the bot is ready. Every attempt is safe to repeat: the day's lease
 * in `BirthdayService` decides who greets.
 *
 * Everything is registered after Discord is ready: a worker that took a job
 * before the client could send would fail it for nothing.
 */
@Injectable()
export class BirthdayCron implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(BirthdayCron.name);
  private followUp: NodeJS.Timeout | undefined;
  private followUps = 0;
  private stopped = false;

  constructor(
    private readonly boss: PgBossService,
    private readonly ready: DiscordReadyService,
    private readonly birthdays: BirthdayService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('birthday-daily', () => this.start());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.followUp);
  }

  private async start(): Promise<void> {
    await this.boss.work(QUEUES.birthdayDaily, {}, async () => {
      const summary = await this.run();
      // Throwing is what makes pg-boss retry the job.
      if (summary.failed > 0) {
        throw new Error(`Birthday wishes failed for ${summary.failed} server(s)`);
      }
    });
    await this.boss.schedule(QUEUES.birthdayDaily, BIRTHDAY_CRON, {});
    await this.run();
  }

  private async run(): Promise<BirthdayRunSummary> {
    const today = businessDayOf(new Date());
    const recovered = await this.birthdays.recoverStaleRuns(today);
    const summary = await this.birthdays.runDailyWishes(today);
    const merged = {
      ...summary,
      failed: summary.failed + recovered.failed,
      sent: summary.sent + recovered.sent,
    };
    this.scheduleFollowUp(laterOf(recovered.retryAt, summary.retryAt));
    return merged;
  }

  /** Looks again when a lease somebody else held lapses, or after a failure. */
  private scheduleFollowUp(retryAt: Date | null): void {
    if (retryAt === null) {
      this.followUps = 0;
      return;
    }
    if (this.stopped || this.followUps >= MAX_FOLLOW_UPS) return;
    this.followUps += 1;
    clearTimeout(this.followUp);
    const delay = Math.max(retryAt.getTime() - Date.now(), 0) + MIN_FOLLOW_UP_MS;
    this.followUp = setTimeout(() => {
      this.run().catch((error: unknown) => {
        this.logger.error(`Birthday follow-up failed (${errorLabel(error)})`);
      });
    }, delay);
    // A pending look-again must not keep the process alive at shutdown.
    this.followUp.unref();
  }
}

function laterOf(a: Date | null, b: Date | null): Date | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}
