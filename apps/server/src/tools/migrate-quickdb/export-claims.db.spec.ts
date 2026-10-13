import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import {
  FIXTURE_GUILD_A,
  FIXTURE_GUILD_B,
  legacyDateKey,
  writeLegacyFixture,
} from '../../testing/legacy-quickdb-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { exportClaims } from './export-claims.js';
import { readLegacy } from './read-source.js';
import { businessDate, shiftDate, transform } from './transform.js';

// 12:00 on 2026-10-13 in Asia/Ho_Chi_Minh.
const NOW = new Date('2026-10-13T05:00:00Z');
const TODAY = businessDate(NOW);
const day = (offset: number) => new Date(`${shiftDate(TODAY, offset)}T00:00:00.000Z`);

describe('export-claims against Postgres', () => {
  let database: TestDatabase;
  let dir: string;

  beforeEach(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    dir = mkdtempSync(join(tmpdir(), 'quickdb-export-'));
    writeLegacyFixture(dir, {
      birthday: {
        max: 20,
        [FIXTURE_GUILD_A]: {
          channel: '200000000000000001',
          wishes: [true, false],
          completedDates: { '2020-1-1': true },
        },
      },
    });
  });

  afterEach(async () => {
    await database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes the finished and in-flight runs of today and yesterday into the legacy file, and nothing older', async () => {
    const guild = await database.prisma.guild.create({ data: { discordId: FIXTURE_GUILD_A } });
    const unknown = await database.prisma.guild.create({ data: { discordId: FIXTURE_GUILD_B } });
    await database.prisma.birthdayCompletedDate.createMany({
      data: [
        // Mid-way through today: the old bot must not greet this day again either.
        {
          guildId: guild.id,
          date: day(0),
          status: 'SENDING',
          leaseUntil: new Date(NOW.getTime() + 60_000),
        },
        { guildId: guild.id, date: day(-1), status: 'DONE' },
        { guildId: guild.id, date: day(-2), status: 'DONE' },
        { guildId: unknown.id, date: day(0), status: 'DONE' },
      ],
    });

    const result = await exportClaims(database.prisma, { targetDir: dir, days: 2, now: NOW });

    expect(result).toEqual({ claims: 1, exportedSending: 1, guildsNotInLegacy: 1 });
    const row = readLegacy(dir).rows.birthday.find((candidate) => candidate.id === FIXTURE_GUILD_A);
    const value = row?.value as Record<string, unknown>;
    expect(value['completedDates']).toEqual({
      '2020-1-1': true,
      [legacyDateKey(TODAY)]: true,
      [legacyDateKey(shiftDate(TODAY, -1))]: true,
    });
    // Everything else on the row is left as the old bot wrote it.
    expect(value['wishes']).toEqual([true, false]);
    expect(value['channel']).toBe('200000000000000001');
    // A guild the old file never knew is not created there.
    expect(
      readLegacy(dir)
        .rows.birthday.map((candidate) => candidate.id)
        .sort(),
    ).toEqual(['max', FIXTURE_GUILD_A].sort());
  });

  it('round-trips: what was exported reads back as the same finished days', async () => {
    const guild = await database.prisma.guild.create({ data: { discordId: FIXTURE_GUILD_A } });
    await database.prisma.birthdayCompletedDate.createMany({
      data: [
        { guildId: guild.id, date: day(0), status: 'DONE' },
        { guildId: guild.id, date: day(-1), status: 'DONE' },
      ],
    });

    await exportClaims(database.prisma, { targetDir: dir, days: 2, now: NOW });
    await exportClaims(database.prisma, { targetDir: dir, days: 2, now: NOW });

    const planned = transform(readLegacy(dir), NOW).guilds.find(
      (candidate) => candidate.discordId === FIXTURE_GUILD_A,
    );
    expect(planned?.completedDates).toEqual([shiftDate(TODAY, -1), TODAY]);
  });
});
