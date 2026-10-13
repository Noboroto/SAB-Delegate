import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppStateModule, AppStateService } from './app-state.service.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

describe('AppStateModule', () => {
  let moduleRef: TestingModule | undefined;

  beforeEach(() => {
    const env: Record<string, string> = {
      APP_ENV: 'production',
      DISCORD_TOKEN: marker('discord'),
      DISCORD_CLIENT_ID: '111111111111111111',
      DISCORD_ALLOWED_APP_IDS: '111111111111111111',
      DISCORD_DEV_GUILD_ID: '',
      ADMIN_GUILD_ID: '333333333333333333',
      POSTGRES_DB: 'sab',
      POSTGRES_USER: 'sab_app',
      POSTGRES_PASSWORD: marker('postgres'),
      LOG_LEVEL: 'silent',
    };
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
  });

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
    vi.unstubAllEnvs();
  });

  it('resolves the service and hands it the Prisma service through the container', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AppStateModule],
    }).compile();
    const service = moduleRef.get(AppStateService);
    expect(service instanceof AppStateService).toBe(true);
    // The client is a Proxy; compare identity as a boolean so a failure does not
    // try to print it.
    expect(Object.is(service['prisma'], moduleRef.get(PrismaService))).toBe(true);
  });

  it('refuses an empty key before touching the database', async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, AppStateModule],
    }).compile();
    const service = moduleRef.get(AppStateService);
    await expect(service.get('')).rejects.toBeInstanceOf(RangeError);
    await expect(service.set('', 'value')).rejects.toBeInstanceOf(RangeError);
  });
});
