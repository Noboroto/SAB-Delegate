import 'reflect-metadata';
import { type NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

describe('GET /health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // No database module or provider is registered: the route has to answer
    // with nothing but its own controller available.
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 200 without touching any dependency', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it('takes no constructor dependencies', () => {
    expect(Reflect.getMetadata('design:paramtypes', HealthController)).toBeUndefined();
  });
});
