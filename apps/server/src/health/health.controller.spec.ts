import 'reflect-metadata';
import { type NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Status } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DiscordReadyService } from '../discord/discord-ready.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { HealthController, LivenessController } from './health.controller.js';

async function startApp(
  providers: unknown[],
  controllers: Array<new (...args: never[]) => unknown>,
): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers,
    providers: providers as never[],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('GET /health/live', () => {
  it('answers 200 with no dependency registered at all', async () => {
    // Neither the database nor Discord is available to this module: the route
    // has to answer with nothing but its own controller.
    const app = await startApp([], [LivenessController]);
    try {
      const response = await app.inject({ method: 'GET', url: '/health/live' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    } finally {
      await app.close();
    }
  });

  it('takes no constructor dependencies', () => {
    expect(Reflect.getMetadata('design:paramtypes', LivenessController)).toBeUndefined();
  });
});

describe('GET /health (readiness)', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    vi.useRealTimers();
  });

  async function readiness(options: {
    pending?: boolean;
    ready?: boolean;
    queryRaw: ReturnType<typeof vi.fn>;
    gateway?: ConstructorParameters<typeof DiscordReadyService>[1];
  }) {
    const discord = new DiscordReadyService(options.pending ?? false, options.gateway);
    if (options.ready) discord.markReady();
    app = await startApp(
      [
        { provide: PrismaService, useValue: { $queryRaw: options.queryRaw } },
        { provide: DiscordReadyService, useValue: discord },
      ],
      [HealthController],
    );
    return app.inject({ method: 'GET', url: '/health' });
  }

  it('is 200 once the database answers and the bot is logged in', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ '?column?': 1 }]);
    const response = await readiness({ ready: true, queryRaw });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      checks: { database: 'up', discord: 'up' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is 503 while the bot is not logged in yet', async () => {
    const response = await readiness({
      ready: false,
      queryRaw: vi.fn().mockResolvedValue([]),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      checks: { database: 'up', discord: 'down' },
    });
  });

  it('is 503 when the gateway dropped after it was ready once', async () => {
    const shard = { status: Status.Ready as Status };
    const gateway = {
      ws: {
        status: Status.Ready,
        shards: { size: 1, every: (test: (s: { status: Status }) => boolean) => test(shard) },
      },
    };
    const queryRaw = vi.fn().mockResolvedValue([]);
    const up = await readiness({ ready: true, queryRaw, gateway });
    expect(up.statusCode).toBe(200);
    await app?.close();

    shard.status = Status.Connecting;
    const down = await readiness({ ready: true, queryRaw, gateway });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toMatchObject({ checks: { database: 'up', discord: 'down' } });
  });

  it('is 503 when the database does not answer', async () => {
    const response = await readiness({
      ready: true,
      queryRaw: vi.fn().mockRejectedValue(new Error('connection refused')),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ checks: { database: 'down', discord: 'up' } });
    // The failure text stays server-side.
    expect(response.body).not.toContain('connection refused');
  });

  it('is 503 when the database ping hangs past its timeout', async () => {
    vi.useFakeTimers();
    const queryRaw = vi.fn().mockReturnValue(new Promise(() => undefined));
    const discord = new DiscordReadyService(false);
    discord.markReady();
    const controller = new HealthController(
      { $queryRaw: queryRaw } as unknown as PrismaService,
      discord,
    );
    const outcome = controller.check().then(
      () => 'resolved',
      (error: { getResponse(): unknown }) => error.getResponse(),
    );
    await vi.advanceTimersByTimeAsync(3500);
    await expect(outcome).resolves.toMatchObject({ checks: { database: 'down' } });
  });

  it('is 200 migration-pending without touching the database or Discord', async () => {
    const queryRaw = vi.fn();
    const response = await readiness({ pending: true, ready: false, queryRaw });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'migration-pending' });
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
