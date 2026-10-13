import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../../vitest-test-database.mjs';
import type { PrismaService } from '../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../testing/test-database.js';
import { AppStateService } from './app-state.service.js';

describe('AppStateService against Postgres', () => {
  let database: TestDatabase;
  let service: AppStateService;

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    // The spec builds the service by hand: the client is bound to a private
    // schema, which PrismaService (one fixed connection) cannot be.
    service = new AppStateService(database.prisma as unknown as PrismaService);
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('returns null for a key that was never set', async () => {
    await expect(service.get('commands:global')).resolves.toBeNull();
  });

  it('keeps one row per key however often it is set, and returns the latest value', async () => {
    await service.set('commands:guild:123', 'hash-1');
    await service.set('commands:guild:123', 'hash-2');
    await service.set('commands:global', 'hash-3');

    await expect(service.get('commands:guild:123')).resolves.toBe('hash-2');
    await expect(
      database.prisma.appState.count({ where: { key: 'commands:guild:123' } }),
    ).resolves.toBe(1);
    await expect(database.prisma.appState.count()).resolves.toBe(2);
  });

  it('survives concurrent writers on the same key', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, index) => service.set('race', `value-${index}`)),
    );
    await expect(database.prisma.appState.count({ where: { key: 'race' } })).resolves.toBe(1);
  });
});
