import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Logger } from '@nestjs/common';
import { QUEUES } from '@sab/shared';
import { Pool } from 'pg';
import type { ConstructorOptions } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../vitest-test-database.mjs';
import { createPool } from '../prisma/pool-factory.js';
import { PgBossService, SCHEDULE_TIME_ZONE } from './pg-boss.service.js';

const run = promisify(execFile);
const INSTALL_SCRIPT = join(__dirname, '..', '..', 'scripts', 'install-pgboss.mjs');
const fastRetry = { attempts: 2, baseDelayMs: 1 };

async function waitFor<T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

describe('PgBossService against Postgres', () => {
  const suffix = randomBytes(5).toString('hex');
  const schema = `pgb_${suffix}`;
  const role = `t_boss_${suffix}`;
  const password = randomBytes(12).toString('hex');
  const services: PgBossService[] = [];

  let admin: Pool;
  let host: string;
  let port: string;
  let database: string;
  let adminUser: string;
  let adminPassword: string;

  const runtimeOptions = (overrides: Partial<ConstructorOptions> = {}): ConstructorOptions => ({
    connectionString: `postgresql://${role}:${password}@${host}:${port}/${database}`,
    schema,
    max: 2,
    options: '-c timezone=UTC',
    migrate: false,
    createSchema: false,
    ...overrides,
  });

  async function startService(
    workers: boolean,
    options = runtimeOptions(),
  ): Promise<PgBossService> {
    const service = new PgBossService(options, workers, fastRetry);
    services.push(service);
    await service.onApplicationBootstrap();
    return service;
  }

  const stopService = async (service: PgBossService) => {
    services.splice(services.indexOf(service), 1);
    await service.onModuleDestroy();
  };

  const count = async (sql: string, values: unknown[] = []) =>
    Number((await admin.query<{ n: string }>(sql, values)).rows[0]?.n);

  const newJobId = async () =>
    (await admin.query<{ id: string }>('SELECT uuidv7()::text AS id')).rows[0]?.id ?? '';

  beforeAll(async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const base = new URL(requireDatabaseUrl().url);
    host = base.hostname;
    port = base.port || '5432';
    database = base.pathname.replace(/^\//, '');
    adminUser = decodeURIComponent(base.username);
    adminPassword = decodeURIComponent(base.password);
    base.searchParams.delete('schema');
    admin = createPool(base.toString(), 2);

    // The runtime role of the real stack: it can log in and nothing else.
    await admin.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}' NOCREATEDB NOCREATEROLE`);
    await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);

    // The release step, run for real as the migrate role.
    await run(process.execPath, [INSTALL_SCRIPT], {
      timeout: 90_000,
      env: {
        PATH: process.env['PATH'],
        PGHOST: host,
        PGPORT: port,
        PGUSER: adminUser,
        PGPASSWORD: adminPassword,
        PGDATABASE: database,
        POSTGRES_USER: role,
        PGBOSS_SCHEMA: schema,
      },
    });
  });

  afterAll(async () => {
    for (const service of services.splice(0)) await service.onModuleDestroy();
    try {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.query(`DROP OWNED BY "${role}"`);
      await admin.query(`DROP ROLE IF EXISTS "${role}"`);
    } finally {
      await admin.end();
      vi.restoreAllMocks();
    }
  });

  describe('a runtime role without CREATE', () => {
    it('cannot create schemas, yet starts, enqueues and works once the release step ran', async () => {
      const probe = new Pool({ connectionString: runtimeOptions().connectionString });
      try {
        await expect(probe.query('CREATE SCHEMA must_not_exist')).rejects.toMatchObject({
          code: '42501',
        });
      } finally {
        await probe.end();
      }

      const service = await startService(true);
      const errors: Error[] = [];
      service.boss.on('error', (error) => errors.push(error));

      const handled: string[] = [];
      await service.work<{ n: number }>(
        QUEUES.scheduledMessageSend,
        { pollingIntervalSeconds: 0.5 },
        (jobs) => {
          for (const job of jobs) handled.push(job.id);
          return Promise.resolve();
        },
      );
      const id = await newJobId();
      await expect(service.send(QUEUES.scheduledMessageSend, { n: 1 }, { id })).resolves.toBe(id);
      await waitFor(
        () => Promise.resolve(handled.includes(id) ? true : undefined),
        'the job to be handled',
        20_000,
      );

      expect(errors).toEqual([]);
      await stopService(service);
    });

    it('fails with a name that says the schema is missing, instead of hanging', async () => {
      const service = new PgBossService(
        runtimeOptions({ schema: `${schema}_absent` }),
        false,
        fastRetry,
      );
      services.push(service);
      await expect(service.onApplicationBootstrap()).rejects.toThrow('PgBossNotInstalled');
      await stopService(service);
    });
  });

  describe('queue behaviour', () => {
    it('creates one job when the same row id is sent twice', async () => {
      const service = await startService(false);
      const id = await newJobId();
      const startAfter = new Date(Date.now() + 3_600_000);

      await expect(
        service.send(QUEUES.scheduledMessageSend, { a: 1 }, { id, startAfter }),
      ).resolves.toBe(id);
      await expect(
        service.send(QUEUES.scheduledMessageSend, { a: 1 }, { id, startAfter }),
      ).resolves.toBeNull();
      expect(await count(`SELECT count(*) AS n FROM "${schema}".job WHERE id = $1`, [id])).toBe(1);
      await stopService(service);
    });

    it('cancels a pending job once, then reports nothing left to cancel', async () => {
      const service = await startService(false);
      const id = await newJobId();
      await service.send(
        QUEUES.scheduledMessageSend,
        {},
        { id, startAfter: new Date(Date.now() + 3_600_000) },
      );

      await expect(service.cancel(QUEUES.scheduledMessageSend, id)).resolves.toBe(1);
      await expect(service.cancel(QUEUES.scheduledMessageSend, id)).resolves.toBe(0);
      await expect(service.cancel(QUEUES.scheduledMessageSend, await newJobId())).resolves.toBe(0);
      const state = await admin.query<{ state: string }>(
        `SELECT state FROM "${schema}".job WHERE id = $1`,
        [id],
      );
      expect(state.rows[0]?.state).toBe('cancelled');
      await stopService(service);
    });

    it('stores the business time zone and sends one catch-up job for several missed days', async () => {
      const first = await startService(false);
      await first.schedule(QUEUES.birthdayDaily, '0 0 * * *');
      const stored = await first.boss.getSchedule(QUEUES.birthdayDaily);
      expect(stored).toMatchObject({
        cron: '0 0 * * *',
        timezone: SCHEDULE_TIME_ZONE,
        options: { missed: 'once' },
      });
      await stopService(first);
      expect(
        await count(`SELECT count(*) AS n FROM "${schema}".job WHERE name = $1`, [
          QUEUES.birthdayDaily,
        ]),
      ).toBe(0);

      // The process was down for three days: the schedule is older than the
      // gap and the last cron pass happened two days ago.
      await admin.query(`UPDATE "${schema}".schedule SET created_on = now() - interval '4 days'`);
      await admin.query(`UPDATE "${schema}".version SET cron_on = now() - interval '2 days'`);

      const second = await startService(false);
      await second.schedule(QUEUES.birthdayDaily, '0 0 * * *');
      await waitFor(
        async () =>
          (await count(`SELECT count(*) AS n FROM "${schema}".job WHERE name = $1`, [
            QUEUES.birthdayDaily,
          ])) > 0
            ? true
            : undefined,
        'the catch-up job',
      );
      // Further cron passes must not add one job per missed day.
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      expect(
        await count(`SELECT count(*) AS n FROM "${schema}".job WHERE name = $1`, [
          QUEUES.birthdayDaily,
        ]),
      ).toBe(1);
      await stopService(second);
    });
  });
});
