import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QUEUES } from '@sab/shared';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { PgBossService } from '../../jobs/pg-boss.service.js';
import { EmailVerifyService } from './email-verify.service.js';

/** 03:30 every day, read in the business time zone by `PgBossService.schedule`. */
export const EMAIL_VERIFY_PURGE_CRON = '30 3 * * *';

/**
 * Deletes expired pending verifications and old send counters once a day.
 * Registered after Discord is ready like the other jobs, which keeps every
 * worker off while a migration is pending. Running twice deletes nothing more,
 * and a failed run throws so pg-boss retries it.
 */
@Injectable()
export class EmailVerifyCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmailVerifyCron.name);

  constructor(
    private readonly boss: PgBossService,
    private readonly ready: DiscordReadyService,
    private readonly verify: EmailVerifyService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('email-verify-purge', () => this.start());
  }

  private async start(): Promise<void> {
    await this.boss.work(QUEUES.emailVerifyPurge, {}, async () => {
      const purged = await this.verify.purgeExpired();
      this.logger.log(
        `Email verification purge removed ${purged.pending} pending, ${purged.sendDays} send counter(s) and ${purged.throttles} member throttle(s)`,
      );
    });
    await this.boss.schedule(QUEUES.emailVerifyPurge, EMAIL_VERIFY_PURGE_CRON, {});
  }
}
