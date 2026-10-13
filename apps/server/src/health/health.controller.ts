import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DiscordReadyService } from '../discord/discord-ready.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Longer than this and the orchestrator's own probe timeout has fired anyway. */
const DATABASE_PING_TIMEOUT_MS = 3000;

// Liveness only: the process is up and the event loop turns. It must stay green
// while Postgres is restarting or the gateway is reconnecting, otherwise a
// supervisor that restarts on this probe kills the process that would have
// recovered on its own. Keep every dependency out of this class.
@Controller('health/live')
export class LivenessController {
  @Get()
  check(): { ok: true } {
    return { ok: true };
  }
}

type ReadinessStatus = 'ok' | 'unavailable' | 'migration-pending';

/**
 * Ready to serve: the database answers and the bot is logged in. This is what
 * the container healthcheck follows, so a deploy is not declared up before the
 * gateway is. During a cutover (`MIGRATION_PENDING`) the bot deliberately stays
 * logged out and the database may be mid-migration; that is reported as its own
 * healthy status instead of a failure.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly discord: DiscordReadyService,
  ) {}

  @Get()
  async check(): Promise<{ status: ReadinessStatus; checks?: Record<string, 'up' | 'down'> }> {
    if (this.discord.migrationPending) return { status: 'migration-pending' };

    const database = await this.databaseUp();
    const discord = this.discord.isReady();
    const checks = {
      database: database ? 'up' : 'down',
      discord: discord ? 'up' : 'down',
    } as const;
    if (!database || !discord) {
      throw new ServiceUnavailableException({
        status: 'unavailable' satisfies ReadinessStatus,
        checks,
      });
    }
    return { status: 'ok', checks };
  }

  private async databaseUp(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const ping = this.prisma.$queryRaw`SELECT 1`;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('database ping timed out')),
          DATABASE_PING_TIMEOUT_MS,
        );
      });
      await Promise.race([ping, expired]);
      return true;
    } catch {
      // The probe answers "down"; the cause is the database client's to log.
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
}
