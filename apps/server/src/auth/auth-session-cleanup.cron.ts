import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { QUEUES } from '@sab/shared';
import { DiscordReadyService } from '../discord/discord-ready.service.js';
import { PgBossService } from '../jobs/pg-boss.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** 03:45 every day, read in the business time zone by `PgBossService.schedule`. */
export const AUTH_SESSION_CLEANUP_CRON = '45 3 * * *';

/**
 * Deletes sessions and verifications that expired, once a day. Better Auth
 * ignores an expired row but never removes it, so without this the tables
 * only grow. Registered
 * after Discord is ready like the other jobs, which keeps every worker off
 * while a migration is pending. Running twice deletes nothing more, and a
 * failed run throws so pg-boss retries it.
 */
@Injectable()
export class AuthSessionCleanupCron implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthSessionCleanupCron.name);

  constructor(
    private readonly boss: PgBossService,
    private readonly ready: DiscordReadyService,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    this.ready.afterReady('auth-session-cleanup', () => this.start());
  }

  async purgeExpired(now: Date = new Date()): Promise<{ sessions: number; verifications: number }> {
    const where = { expiresAt: { lt: now } };
    const [sessions, verifications] = await Promise.all([
      this.prisma.session.deleteMany({ where }),
      this.prisma.verification.deleteMany({ where }),
    ]);
    return { sessions: sessions.count, verifications: verifications.count };
  }

  private async start(): Promise<void> {
    await this.boss.work(QUEUES.authSessionCleanup, {}, async () => {
      const removed = await this.purgeExpired();
      this.logger.log(
        `Session cleanup removed ${removed.sessions} expired session(s) and ${removed.verifications} verification(s)`,
      );
    });
    await this.boss.schedule(QUEUES.authSessionCleanup, AUTH_SESSION_CLEANUP_CRON, {});
  }
}
