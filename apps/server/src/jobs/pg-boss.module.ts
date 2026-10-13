import { Module } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { DEFAULT_CONNECT_RETRY } from '../prisma/pool-factory.js';
import {
  PGBOSS_CONNECT_RETRY,
  PGBOSS_OPTIONS,
  PGBOSS_WORKERS_ENABLED,
  PgBossService,
  buildPgBossOptions,
} from './pg-boss.service.js';

@Module({
  providers: [
    // Factories, so the environment is read when the module is built and not
    // at import time.
    { provide: PGBOSS_OPTIONS, useFactory: () => buildPgBossOptions() },
    { provide: PGBOSS_WORKERS_ENABLED, useFactory: () => loadEnv().PGBOSS_WORKERS_ENABLED },
    { provide: PGBOSS_CONNECT_RETRY, useValue: DEFAULT_CONNECT_RETRY },
    PgBossService,
  ],
  exports: [PgBossService],
})
export class PgBossModule {}
