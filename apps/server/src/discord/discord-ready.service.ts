import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { errorLabel } from '../prisma/pool-factory.js';

const MIGRATION_PENDING = Symbol('MIGRATION_PENDING');

/**
 * Whether the Discord gateway session is up, and the signal everything that
 * must wait for it hangs off (workers, cron schedules, the readiness probe).
 *
 * In migration-pending mode the bot never logs in, so `isReady()` stays false
 * and tasks queued with `afterReady` never run: that is how workers and cron
 * stay off during a cutover.
 */
@Injectable()
export class DiscordReadyService {
  private readonly logger = new Logger(DiscordReadyService.name);
  private ready = false;
  private readonly queued: Array<{ label: string; task: () => void | Promise<void> }> = [];

  constructor(@Inject(MIGRATION_PENDING) readonly migrationPending: boolean) {}

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Runs `task` once the gateway is ready, or right away if it already is.
   * Returns at once, on purpose: awaiting readiness inside a lifecycle hook
   * would block the very bootstrap step that performs the login. A failing
   * task is logged by name and never rethrown; the others still run.
   */
  afterReady(label: string, task: () => void | Promise<void>): void {
    if (this.ready) {
      void this.run(label, task);
      return;
    }
    this.queued.push({ label, task });
  }

  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    for (const { label, task } of this.queued.splice(0)) void this.run(label, task);
  }

  private async run(label: string, task: () => void | Promise<void>): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.error(`Task "${label}" failed after Discord ready (${errorLabel(error)})`);
    }
  }
}

@Module({
  providers: [
    // A factory, so the environment is read when the module is built, not at import.
    { provide: MIGRATION_PENDING, useFactory: () => loadEnv().MIGRATION_PENDING },
    DiscordReadyService,
  ],
  exports: [DiscordReadyService],
})
export class DiscordReadyModule {}
