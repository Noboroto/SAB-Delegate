import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { Pool } from 'pg';
import {
  DEFAULT_CONNECT_RETRY,
  connectWithRetry,
  createPrismaConnection,
  errorLabel,
  type ConnectRetryPolicy,
} from './pool-factory.js';

/** Overrides the connect retry budget; the default applies when nothing provides it. */
export const PRISMA_CONNECT_RETRY = Symbol('PRISMA_CONNECT_RETRY');

/**
 * Prisma 7 needs a driver adapter for a direct connection; this one runs over
 * an explicit pg Pool so its size, timeouts and session time zone are set here.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;
  private readonly retry: ConnectRetryPolicy;

  constructor(@Optional() @Inject(PRISMA_CONNECT_RETRY) retry?: ConnectRetryPolicy) {
    const { pool, adapter } = createPrismaConnection();
    super({ adapter });
    this.pool = pool;
    this.retry = retry ?? DEFAULT_CONNECT_RETRY;
  }

  /**
   * A real round trip, not just `$connect`: the probe is what proves the
   * credentials and the database name are good before the server accepts work.
   */
  async onModuleInit(): Promise<void> {
    await connectWithRetry(
      async () => {
        await this.$connect();
        await this.$queryRaw`SELECT 1`;
      },
      this.retry,
      ({ attempt, label, retryInMs }) => {
        this.logger.warn(
          retryInMs === undefined
            ? `Database connect attempt ${attempt} failed (${label}); giving up`
            : `Database connect attempt ${attempt} failed (${label}); retrying in ${retryInMs} ms`,
        );
      },
    );
    this.logger.log('Database connected');
  }

  /**
   * Closed in onApplicationShutdown, after every onModuleDestroy hook has
   * finished: a job that is still draining in a destroy hook (the pg-boss
   * stop) keeps using this pool, so closing it earlier breaks that job.
   *
   * Nothing here may throw. Nest awaits the hooks of all modules together, so a
   * rejection would skip the rest of the shutdown, and `pool.end()` rejects
   * whenever the pool was already ended (a second shutdown signal).
   */
  async onApplicationShutdown(): Promise<void> {
    let clean = true;
    try {
      await this.$disconnect();
    } catch (error) {
      clean = false;
      this.logger.warn(`Prisma disconnect failed: ${errorLabel(error)}`);
    }
    try {
      await this.pool.end();
    } catch (error) {
      clean = false;
      this.logger.warn(`Postgres pool close failed: ${errorLabel(error)}`);
    }
    if (clean) this.logger.log('Database disconnected');
  }
}
