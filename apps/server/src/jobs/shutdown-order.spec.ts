import 'reflect-metadata';
import { setTimeout as sleep } from 'node:timers/promises';
import { Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PgBossModule } from './pg-boss.module.js';
import {
  PGBOSS_CONNECT_RETRY,
  PGBOSS_OPTIONS,
  PGBOSS_WORKERS_ENABLED,
  PgBossService,
} from './pg-boss.service.js';

/**
 * A job that is still draining while the server shuts down keeps using the
 * database pool, so the pool has to outlive pg-boss's stop. The rule: pg-boss
 * stops in `onModuleDestroy`, Prisma closes in `onApplicationShutdown`, which
 * Nest runs only after every `onModuleDestroy` has finished. Nothing in either
 * library enforces this; this spec does.
 */

type Event = 'boss.stop.begin' | 'boss.stop.end' | 'prisma.close';

/** The invariant under test: pg-boss finished stopping before the pool was touched. */
function bossStoppedBeforeClose(events: readonly Event[]): boolean {
  const stopped = events.indexOf('boss.stop.end');
  const closed = events.indexOf('prisma.close');
  return stopped !== -1 && closed !== -1 && stopped < closed;
}

const STOP_DURATION_MS = 40;

describe('bossStoppedBeforeClose', () => {
  it('is true only when the stop finished before the first close', () => {
    expect(bossStoppedBeforeClose(['boss.stop.begin', 'boss.stop.end', 'prisma.close'])).toBe(true);
    expect(bossStoppedBeforeClose(['prisma.close', 'boss.stop.begin', 'boss.stop.end'])).toBe(
      false,
    );
    expect(bossStoppedBeforeClose(['boss.stop.begin', 'prisma.close', 'boss.stop.end'])).toBe(
      false,
    );
    expect(bossStoppedBeforeClose(['boss.stop.begin', 'boss.stop.end'])).toBe(false);
    expect(bossStoppedBeforeClose([])).toBe(false);
  });
});

describe('shutdown order', () => {
  let events: Event[];
  let app: TestingModule | undefined;

  beforeEach(() => {
    events = [];
    for (const [name, value] of Object.entries({
      APP_ENV: 'production',
      DISCORD_TOKEN: 'token-for-the-boot-check',
      DISCORD_CLIENT_ID: '111111111111111111',
      DISCORD_ALLOWED_APP_IDS: '111111111111111111',
      DISCORD_DEV_GUILD_ID: '',
      ADMIN_GUILD_ID: '333333333333333333',
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '1',
      POSTGRES_DB: 'sab',
      POSTGRES_USER: 'sab_app',
      POSTGRES_PASSWORD: 'password-for-the-boot-check',
      LOG_LEVEL: 'silent',
    })) {
      vi.stubEnv(name, value);
    }
    // No database in this spec: the connect and start hooks are not under test.
    vi.spyOn(PrismaService.prototype, 'onModuleInit').mockResolvedValue();
    vi.spyOn(PgBossService.prototype, 'onApplicationBootstrap').mockResolvedValue();
    // `end` resolves to nothing the caller reads; returning nothing keeps the
    // mock on the overload whose callback form returns void.
    vi.spyOn(Pool.prototype, 'end').mockImplementation(() => {
      events.push('prisma.close');
    });
  });

  afterEach(async () => {
    await app?.close().catch(() => undefined);
    app = undefined;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  /** A stop that takes time, like draining a running job. */
  function slowStop(service: PgBossService): void {
    vi.spyOn(service.boss, 'stop').mockImplementation(async () => {
      events.push('boss.stop.begin');
      await sleep(STOP_DURATION_MS);
      events.push('boss.stop.end');
    });
  }

  it('finishes pg-boss before the Prisma pool is closed', async () => {
    app = await Test.createTestingModule({ imports: [PgBossModule, PrismaModule] }).compile();
    slowStop(app.get(PgBossService));
    vi.spyOn(app.get(PrismaService), '$disconnect').mockImplementation(() => {
      events.push('prisma.close');
      return Promise.resolve();
    });
    await app.init();
    await app.close();
    app = undefined;

    expect(events).toContain('boss.stop.end');
    expect(bossStoppedBeforeClose(events)).toBe(true);
  });

  it('is detected when the pool closes in onModuleDestroy instead', async () => {
    // A database service that closes its pool in the destroy phase, in the same
    // module as pg-boss: Nest runs the hooks of one module together, so the
    // close lands while the stop is still draining. Across modules the order
    // would depend on import order, which is why the rule uses two phases.
    @Injectable()
    class EarlyClosingDatabase implements OnModuleDestroy {
      onModuleDestroy(): void {
        events.push('prisma.close');
      }
    }
    @Module({
      providers: [
        {
          provide: PGBOSS_OPTIONS,
          useValue: { connectionString: 'postgresql://u:p@127.0.0.1:1/db', migrate: false },
        },
        { provide: PGBOSS_WORKERS_ENABLED, useValue: false },
        { provide: PGBOSS_CONNECT_RETRY, useValue: { attempts: 1, baseDelayMs: 1 } },
        PgBossService,
        EarlyClosingDatabase,
      ],
    })
    class ControlModule {}

    app = await Test.createTestingModule({ imports: [ControlModule] }).compile();
    slowStop(app.get(PgBossService));
    await app.init();
    await app.close();
    app = undefined;

    expect(events).toContain('boss.stop.end');
    expect(bossStoppedBeforeClose(events)).toBe(false);
  });
});
