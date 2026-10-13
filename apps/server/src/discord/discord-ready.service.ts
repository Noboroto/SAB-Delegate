import { Inject, Injectable, Logger, Module, Optional, type OnModuleDestroy } from '@nestjs/common';
import { Client, Status } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { errorLabel } from '../prisma/pool-factory.js';

const MIGRATION_PENDING = Symbol('MIGRATION_PENDING');

/** The slice of the client that tells whether the gateway connection is up right now. */
type GatewayPort = {
  ws: {
    status: Status;
    shards: { size: number; every(predicate: (shard: { status: Status }) => boolean): boolean };
  };
};

/**
 * Whether the Discord gateway session is up, and the signal everything that
 * must wait for it hangs off (workers, cron schedules, the readiness probe).
 *
 * In migration-pending mode the bot never logs in, so `isReady()` stays false
 * and tasks queued with `afterReady` never run: that is how workers and cron
 * stay off during a cutover.
 */
@Injectable()
export class DiscordReadyService implements OnModuleDestroy {
  private readonly logger = new Logger(DiscordReadyService.name);
  private ready = false;
  private stopping = false;
  private readonly queued: Array<{ label: string; task: () => void | Promise<void> }> = [];

  constructor(
    @Inject(MIGRATION_PENDING) readonly migrationPending: boolean,
    // Absent while migration is pending: no client is built then.
    @Optional() @Inject(Client) private readonly gateway?: GatewayPort,
  ) {}

  /**
   * Logged in once, still connected, and not shutting down. The manager's own
   * `ws.status` turns Ready on the first login and never leaves it, so a
   * dropped connection only shows in the status of the shards.
   */
  isReady(): boolean {
    return this.ready && !this.stopping && this.gatewayConnected();
  }

  /** True once shutdown began: loops over many servers stop between items instead of using a closing pool. */
  isStopping(): boolean {
    return this.stopping;
  }

  onModuleDestroy(): void {
    this.stopping = true;
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

  private gatewayConnected(): boolean {
    const ws = this.gateway?.ws;
    if (ws === undefined) return true;
    return (
      ws.status === Status.Ready &&
      ws.shards.size > 0 &&
      ws.shards.every((shard) => shard.status === Status.Ready)
    );
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
