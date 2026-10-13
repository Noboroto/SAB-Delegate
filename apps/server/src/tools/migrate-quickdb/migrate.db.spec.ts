import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import {
  FIXTURE_GUILD_A,
  FIXTURE_GUILD_B,
  prodShapedContent,
  writeLegacyFixture,
} from '../../testing/legacy-quickdb-fixtures.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { TargetNotEmptyError, applyPlan, countTarget } from './load.js';
import { checkDictionary, readLegacy } from './read-source.js';
import { buildReport, exitCodeFor, formatReport } from './report.js';
import { businessDate, shiftDate, transform } from './transform.js';
import { APPLY_ORDER, type MigrateOptions, type Plan } from './types.js';

// 12:00 on 2026-10-13 in Asia/Ho_Chi_Minh.
const NOW = new Date('2026-10-13T05:00:00Z');
const OPTIONS: MigrateOptions = {
  command: 'migrate',
  sourceDir: 'unused',
  apply: true,
  allowNonEmpty: false,
  dictAsset: null,
};

describe('quick.db migration against Postgres', () => {
  let database: TestDatabase;
  let dir: string;
  let plan: Plan;
  let data: ReturnType<typeof readLegacy>;

  beforeEach(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    dir = mkdtempSync(join(tmpdir(), 'quickdb-apply-'));
    writeLegacyFixture(dir, prodShapedContent(NOW));
    data = readLegacy(dir);
    plan = transform(data, NOW);
  });

  afterEach(async () => {
    await database.dispose();
    rmSync(dir, { recursive: true, force: true });
  });

  const rowCounts = () => countTarget(database.prisma);

  it('loads every planned row and reports source against target per table', async () => {
    const applied = await applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW });

    expect(applied.failures).toEqual([]);
    expect(applied.inserted).toEqual({
      Guild: 4,
      GuildConfig: 4,
      BirthdayCompletedDate: 4,
      BirthdayWishUsage: 5,
      BirthdayEntry: 3,
      NoteEntry: 0,
      WordGameState: 2,
      WordGameUsedWord: 2,
    });
    expect(applied.inserted).toEqual(applied.planned);
    await expect(rowCounts()).resolves.toEqual(applied.inserted);

    const report = buildReport({
      options: OPTIONS,
      data,
      plan,
      dictionary: checkDictionary(data.dictKeyCount, null),
      applied,
    });
    expect(report.tables.map((row) => row.table)).toEqual([...APPLY_ORDER]);
    expect(exitCodeFor(report)).toBe(0);
    expect(report.skipped.NOTE_UNATTRIBUTABLE).toBe(1);
  });

  it('maps the legacy values onto the right columns', async () => {
    await applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW });
    const guild = await database.prisma.guild.findUniqueOrThrow({
      where: { discordId: FIXTURE_GUILD_A },
      include: { config: true, wordGame: { include: { usedWords: true } } },
    });
    expect(guild.config).toMatchObject({
      introChannelId: '210000000000000001',
      birthdayChannelId: '200000000000000001',
      wordChannelId: '220000000000000001',
      wordMaxWords: 1500,
    });
    expect(guild.wordGame).toMatchObject({ started: false, lastWord: 'world', count: 3 });
    expect(guild.wordGame?.usedWords.map((row) => row.word).sort()).toEqual(['hello', 'world']);

    const usage = await database.prisma.birthdayWishUsage.findMany({
      where: { guildId: guild.id },
      orderBy: { wishIndex: 'asc' },
    });
    expect(usage.map((row) => row.wishIndex)).toEqual([3, 7, 19]);
    await expect(
      database.prisma.birthdayEntry.findMany({
        where: { guildId: guild.id, month: 2, day: 29 },
      }),
    ).resolves.toHaveLength(1);
  });

  it('is idempotent: a second apply changes no row count', async () => {
    await applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW });
    const before = await rowCounts();

    const second = await applyPlan(database.prisma, plan, { allowNonEmpty: true, now: NOW });

    expect(Object.values(second.inserted).every((count) => count === 0)).toBe(true);
    expect(second.existing).toEqual(second.planned);
    expect(second.failures).toEqual([]);
    await expect(rowCounts()).resolves.toEqual(before);
  });

  it('loads only the last three finished days, and the claims before the birthday list', async () => {
    await applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW });
    const guild = await database.prisma.guild.findUniqueOrThrow({
      where: { discordId: FIXTURE_GUILD_A },
    });

    const claims = await database.prisma.birthdayCompletedDate.findMany({
      where: { guildId: guild.id },
      orderBy: { date: 'asc' },
    });
    const today = businessDate(NOW);
    expect(claims.map((claim) => claim.date.toISOString().slice(0, 10))).toEqual([
      shiftDate(today, -2),
      shiftDate(today, -1),
      today,
    ]);
    expect(claims.every((claim) => claim.status === 'DONE' && claim.leaseUntil === null)).toBe(
      true,
    );

    // uuidv7 ids sort by creation time within one session, so a claim that was
    // inserted first has a smaller id than every list entry of its guild.
    const entries = await database.prisma.birthdayEntry.findMany({ where: { guildId: guild.id } });
    const lastClaimId = claims
      .map((claim) => claim.id)
      .sort()
      .at(-1) as string;
    const firstEntryId = entries.map((entry) => entry.id).sort()[0] as string;
    expect(lastClaimId < firstEntryId).toBe(true);
  });

  it('refuses a target that already has rows and writes nothing', async () => {
    await database.prisma.guild.create({ data: { discordId: FIXTURE_GUILD_B } });
    const before = await rowCounts();

    await expect(
      applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW }),
    ).rejects.toBeInstanceOf(TargetNotEmptyError);
    await expect(rowCounts()).resolves.toEqual(before);
  });

  it('with --allow-non-empty fills what is missing, never overwrites, and says so in the report', async () => {
    await database.prisma.guild.create({
      data: {
        discordId: FIXTURE_GUILD_A,
        config: { create: { wordMaxWords: 777, introChannelId: '900000000000000001' } },
      },
    });

    const applied = await applyPlan(database.prisma, plan, { allowNonEmpty: true, now: NOW });

    expect(applied.allowedNonEmpty).toBe(true);
    expect(applied.inserted.Guild).toBe(3);
    expect(applied.inserted.GuildConfig).toBe(3);
    expect(applied.existing.Guild).toBe(1);
    expect(applied.existing.GuildConfig).toBe(1);
    expect(applied.existing.BirthdayEntry).toBe(0);
    const config = await database.prisma.guildConfig.findFirstOrThrow({
      where: { guild: { discordId: FIXTURE_GUILD_A } },
    });
    expect(config).toMatchObject({ wordMaxWords: 777, introChannelId: '900000000000000001' });
    // The rest of the guild's data still loaded next to the existing config.
    await expect(
      database.prisma.birthdayEntry.count({ where: { guild: { discordId: FIXTURE_GUILD_A } } }),
    ).resolves.toBe(2);

    const text = formatReport(
      buildReport({
        options: { ...OPTIONS, allowNonEmpty: true },
        data,
        plan,
        dictionary: { status: 'SKIPPED_NO_ASSET' },
        applied,
      }),
    );
    expect(text).toContain('allow-non-empty=true');
    expect(text).toContain('target was not empty');
    expect(text).toContain('TARGET_ROW_EXISTS (existing, not overwritten): Guild=1 GuildConfig=1');
  });

  it('rolls back a failing guild alone and fails the run', async () => {
    const broken: Plan = {
      ...plan,
      guilds: plan.guilds.map((planned) =>
        planned.discordId === FIXTURE_GUILD_A
          ? {
              ...planned,
              birthdays: [{ studentId: 'X', name: 'x', discordId: '1', month: 13, day: 1 }],
            }
          : planned,
      ),
    };

    const applied = await applyPlan(database.prisma, broken, { allowNonEmpty: false, now: NOW });

    expect(applied.failures).toHaveLength(1);
    expect(applied.failures[0]?.guildKey).toMatch(/^[0-9a-f]{8}$/);
    await expect(
      database.prisma.guild.count({ where: { discordId: FIXTURE_GUILD_A } }),
    ).resolves.toBe(0);
    await expect(database.prisma.guild.count()).resolves.toBe(3);
    const report = buildReport({
      options: OPTIONS,
      data,
      plan: broken,
      dictionary: { status: 'SKIPPED_NO_ASSET' },
      applied,
    });
    expect(exitCodeFor(report)).toBe(1);
  });

  it('never prints a member value or a guild id in the report', async () => {
    const applied = await applyPlan(database.prisma, plan, { allowNonEmpty: false, now: NOW });
    const text = formatReport(
      buildReport({
        options: OPTIONS,
        data,
        plan,
        dictionary: { status: 'SKIPPED_NO_ASSET' },
        applied,
      }),
    );
    for (const value of ['Member', '30000000', FIXTURE_GUILD_A, FIXTURE_GUILD_B, 'hello']) {
      expect(text).not.toContain(value);
    }
  });

  it('a dry run reads no database: the report comes from the plan alone', () => {
    const text = formatReport(
      buildReport({
        options: { ...OPTIONS, apply: false },
        data,
        plan,
        dictionary: { status: 'SKIPPED_NO_ASSET' },
        applied: null,
      }),
    );
    expect(text).toContain('Mode: dry-run (nothing written)');
    expect(text).toMatch(/BirthdayEntry\s+3\s+-\s+-/);
  });
});
