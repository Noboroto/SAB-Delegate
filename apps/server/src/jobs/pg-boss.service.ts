import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { BUSINESS_TIME_ZONE, z, type QueueName } from '@sab/shared';
import { PgBoss, type ConstructorOptions, type WorkHandler, type WorkOptions } from 'pg-boss';
import { resolveDatabaseUrl } from '../config/database-url.js';
import { loadEnv } from '../config/env.js';
import {
  POOL_CONNECTION_TIMEOUT_MS,
  UTC_SESSION_OPTIONS,
  connectWithRetry,
  errorLabel,
  type ConnectRetryPolicy,
} from '../prisma/pool-factory.js';

export const PGBOSS_OPTIONS = Symbol('PGBOSS_OPTIONS');
export const PGBOSS_WORKERS_ENABLED = Symbol('PGBOSS_WORKERS_ENABLED');
/** The start retry budget: the same one the Prisma connect uses. */
export const PGBOSS_CONNECT_RETRY = Symbol('PGBOSS_CONNECT_RETRY');

export const PGBOSS_SCHEMA = 'pgboss';

/** Time given to jobs in flight to finish before the process stops waiting. */
export const STOP_TIMEOUT_MS = 30_000;

/** Repeated connection errors during an outage are logged once per window. */
export const ERROR_LOG_WINDOW_MS = 10_000;

/**
 * The runtime role has no CREATE, so it never installs or migrates the pg-boss
 * schema: the release job does that as the migrate role. A runtime that finds
 * the schema missing or old fails with a name that says so.
 */
const SCHEMA_ERRORS: Readonly<Record<string, string>> = {
  'pg-boss is not installed': 'PgBossNotInstalled',
  'pg-boss database requires migrations': 'PgBossMigrationPending',
};

// The published type of a cancel response is an empty interface, so the count
// is read through a schema instead of being assumed.
const CancelResponse = z.object({ affected: z.number().int().min(0) });

export function buildPgBossOptions(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ConstructorOptions {
  return {
    connectionString: resolveDatabaseUrl(env),
    schema: PGBOSS_SCHEMA,
    max: loadEnv(env).PGBOSS_POOL_MAX,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
    // Same session time zone as the Prisma pool, so a timestamp means the same
    // thing whichever pool wrote it.
    options: UTC_SESSION_OPTIONS,
    application_name: 'sab-server',
    migrate: false,
    createSchema: false,
  };
}

/**
 * The only door to pg-boss: modules enqueue and register workers through here.
 *
 * Shutdown order matters. This service stops in `onModuleDestroy`, which lets a
 * job that is still running finish; Prisma closes its pool in a later phase
 * (`onApplicationShutdown`), because a job in flight keeps using that pool.
 */
@Injectable()
export class PgBossService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PgBossService.name);
  private readonly queues = new Map<string, Promise<void>>();
  private stopped = false;
  private lastErrorLogAt = Number.NEGATIVE_INFINITY;
  private suppressedErrors = 0;
  private resolveStarted!: () => void;
  private rejectStarted!: (error: unknown) => void;

  /** The underlying instance; feature code goes through the methods below. */
  readonly boss: PgBoss;

  /** Settles when the connection is up. Everything that touches queues awaits it. */
  readonly started = new Promise<void>((resolve, reject) => {
    this.resolveStarted = resolve;
    this.rejectStarted = reject;
  });

  constructor(
    @Inject(PGBOSS_OPTIONS) options: ConstructorOptions,
    @Inject(PGBOSS_WORKERS_ENABLED) private readonly workersEnabled: boolean,
    @Inject(PGBOSS_CONNECT_RETRY) private readonly retry: ConnectRetryPolicy,
  ) {
    this.boss = new PgBoss(options);
    // Before start(): an 'error' event with no listener is thrown, and a
    // Postgres restart emits one per dropped connection, which would end the
    // process.
    this.boss.on('error', (error) => this.logError(error));
    // A rejection nobody awaits (no worker registered yet) must not be reported
    // as unhandled; the bootstrap hook rethrows it to Nest anyway.
    void this.started.catch(() => undefined);
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await connectWithRetry(
        async () => {
          try {
            await this.boss.start();
          } catch (error) {
            const name = error instanceof Error ? SCHEMA_ERRORS[error.message] : undefined;
            if (name === undefined) throw error;
            throw Object.assign(new Error(name), { name });
          }
        },
        this.retry,
        ({ attempt, label, retryInMs }) => {
          this.logger.warn(
            retryInMs === undefined
              ? `pg-boss start attempt ${attempt} failed (${label}); giving up`
              : `pg-boss start attempt ${attempt} failed (${label}); retrying in ${retryInMs} ms`,
          );
        },
      );
      this.resolveStarted();
      this.logger.log('pg-boss started');
    } catch (error) {
      this.rejectStarted(error);
      throw error;
    }
  }

  /** Runs before any `onApplicationShutdown` hook; see the class comment. */
  async onModuleDestroy(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    try {
      await this.boss.stop({ graceful: true, timeout: STOP_TIMEOUT_MS });
    } catch (error) {
      // Nest awaits every module's hook together; a throw here would skip the
      // rest of the shutdown, including closing the database pool.
      this.logger.warn(`pg-boss stop failed: ${errorLabel(error)}`);
    }
  }

  /**
   * Registers a worker. The handler receives a batch and must await its work
   * and throw on failure, which is what makes pg-boss retry the jobs. With
   * workers disabled the queue still exists (so `send` works) but nothing
   * consumes it in this process.
   */
  async work<Data extends object>(
    queue: QueueName,
    options: WorkOptions,
    handler: WorkHandler<Data>,
  ): Promise<string | null> {
    await this.ensureQueue(queue);
    if (!this.workersEnabled) {
      this.logger.warn(`Workers disabled: no worker registered for "${queue}"`);
      return null;
    }
    return this.boss.work<Data, unknown, WorkOptions>(queue, options, handler);
  }

  /**
   * Enqueues a job. `id` is the primary key of the database row the job acts
   * on, so sending the same row twice creates one job (the second call returns
   * null). Ids are never generated here. Throws while the database is down;
   * the caller decides what that means for its own row.
   */
  async send(
    queue: QueueName,
    data: object,
    options: { id: string; startAfter?: Date },
  ): Promise<string | null> {
    await this.ensureQueue(queue);
    return this.boss.send(queue, data, options);
  }

  /** Number of jobs cancelled: 0 means the job already ran, was cancelled, or never existed. */
  async cancel(queue: QueueName, id: string): Promise<number> {
    await this.started;
    return CancelResponse.parse(await this.boss.cancel(queue, id)).affected;
  }

  /**
   * Upserts a recurring job, read in the business time zone (Vietnamese days
   * wherever the host runs, not the server's zone). Safe to call on
   * every boot. `missed: 'once'` sends a single catch-up job when the process
   * was down at the due time, however many occurrences were missed.
   */
  async schedule(queue: QueueName, cron: string, data: object = {}): Promise<void> {
    await this.ensureQueue(queue);
    await this.boss.schedule(queue, cron, data, { tz: BUSINESS_TIME_ZONE, missed: 'once' });
  }

  private ensureQueue(queue: QueueName): Promise<void> {
    let ready = this.queues.get(queue);
    if (ready === undefined) {
      ready = this.started.then(() => this.boss.createQueue(queue));
      this.queues.set(queue, ready);
      // A failed attempt is not cached: the next caller tries again.
      void ready.catch(() => this.queues.delete(queue));
    }
    return ready;
  }

  private logError(error: Error): void {
    const now = Date.now();
    if (now - this.lastErrorLogAt < ERROR_LOG_WINDOW_MS) {
      this.suppressedErrors += 1;
      return;
    }
    const suppressed = this.suppressedErrors;
    this.lastErrorLogAt = now;
    this.suppressedErrors = 0;
    this.logger.error(
      `pg-boss error: ${errorLabel(error)}${suppressed > 0 ? ` (+${suppressed} similar)` : ''}`,
    );
  }
}
