import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ErrorReporter } from '../../discord/error-reporter.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { BirthdayService } from './birthday.service.js';

const GUILD = '100000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const ANN = '300000000000000001';
const BOB = '300000000000000002';

const person = (studentId: string, discordId: string) => ({
  studentId,
  name: `Name ${studentId}`,
  discordId,
  month: 3,
  day: 15,
});

afterEach(() => {
  vi.restoreAllMocks();
});

function build(overrides: { existing?: string[]; matches?: number } = {}) {
  const found = (overrides.matches ?? 0) > 0;
  const entry = {
    count: vi.fn().mockResolvedValue(overrides.matches ?? 0),
    findMany: vi.fn((args: { select?: Record<string, boolean>; where?: object }) => {
      if (args.select !== undefined && Object.keys(args.select).length === 1) {
        return Promise.resolve((overrides.existing ?? []).map((studentId) => ({ studentId })));
      }
      return Promise.resolve(found ? [person('SE1', ANN)] : []);
    }),
    deleteMany: vi.fn().mockResolvedValue({ count: overrides.matches ?? 0 }),
    createMany: vi.fn((args: { data: unknown[] }) => Promise.resolve({ count: args.data.length })),
  };
  const tx = { birthdayEntry: entry };
  const prisma = {
    birthdayEntry: entry,
    $transaction: vi.fn((work: (client: typeof tx) => unknown) => work(tx)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = { ensureGuild: vi.fn().mockResolvedValue({ id: 'internal-guild' }) };
  const service = new BirthdayService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
    {} as never,
    { report: vi.fn() } as unknown as ErrorReporter,
    { isStopping: () => false } as unknown as DiscordReadyService,
  );
  return { service, prisma, entry, audit, guilds };
}

describe('BirthdayService.remove', () => {
  it('lets a student ID win over a Discord user', async () => {
    const { service, entry } = build({ matches: 1 });
    const result = await service.remove(GUILD, { studentId: 'SE1', discordId: ANN }, ACTOR);
    expect(result).toMatchObject({ dryRun: false, code: 'REMOVED_BY_STUDENT', count: 1 });
    expect(entry.deleteMany).toHaveBeenCalledWith({
      where: { guild: { discordId: GUILD }, studentId: 'SE1' },
    });
  });

  it('removes by Discord user when no student ID is given', async () => {
    const { service, entry } = build({ matches: 2 });
    const result = await service.remove(GUILD, { discordId: ANN }, ACTOR);
    expect(result).toMatchObject({ code: 'REMOVED_BY_USER', count: 2 });
    expect(entry.deleteMany).toHaveBeenCalledWith({
      where: { guild: { discordId: GUILD }, discordId: ANN },
    });
  });

  it('answers NO_SELECTOR without touching the database', async () => {
    const { service, prisma } = build();
    await expect(service.remove(GUILD, {}, ACTOR)).resolves.toEqual({
      dryRun: false,
      code: 'NO_SELECTOR',
      count: 0,
      sample: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND without an audit row when nobody matched', async () => {
    const { service, entry, audit } = build({ matches: 0 });
    await expect(service.remove(GUILD, { studentId: 'SE9' }, ACTOR)).resolves.toMatchObject({
      code: 'NOT_FOUND',
      count: 0,
    });
    expect(entry.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('records who removed what, in the transaction that removed it', async () => {
    const { service, audit } = build({ matches: 1 });
    await service.remove(GUILD, { studentId: 'SE1' }, ACTOR);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.birthdayRemove,
        params: { count: 1, targetId: 'SE1' },
      },
      expect.anything(),
    );
  });

  it('with dryRun reports the plan and writes nothing, not even an audit row', async () => {
    const { service, prisma, entry, audit } = build({ matches: 1 });
    const result = await service.remove(GUILD, { studentId: 'SE1' }, ACTOR, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, code: 'REMOVED_BY_STUDENT', count: 1 });
    expect(result.sample.map((entry) => entry.studentId)).toEqual(['SE1']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(entry.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a dry run and the real run name the same people', async () => {
    const { service } = build({ matches: 1 });
    const plan = await service.remove(GUILD, { studentId: 'SE1' }, ACTOR, { dryRun: true });
    const done = await service.remove(GUILD, { studentId: 'SE1' }, ACTOR, { dryRun: false });
    expect(done.code).toBe(plan.code);
    expect(done.count).toBe(plan.count);
    expect(done.sample).toEqual(plan.sample);
  });

  it('refuses an id that is not a Discord id', async () => {
    const { service } = build();
    await expect(service.remove(GUILD, { discordId: '<@1>' }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.remove('nope', { studentId: 'SE1' }, ACTOR)).rejects.toBeInstanceOf(
      ServiceError,
    );
  });
});

describe('BirthdayService.importRows', () => {
  const rows = [person('SE1', ANN), person('SE2', BOB), person('SE3', BOB)];

  it('adds what is new and names the student IDs it already had', async () => {
    const { service, entry, guilds } = build({ existing: ['SE2'] });
    const result = await service.importRows(GUILD, rows, ACTOR);
    expect(result).toEqual({
      dryRun: false,
      total: 3,
      added: 2,
      duplicates: ['SE2'],
      sample: ['SE1', 'SE3'],
    });
    expect(guilds.ensureGuild).toHaveBeenCalledWith(GUILD, undefined, expect.anything());
    const inserted = (entry.createMany.mock.calls[0]?.[0] as { data: Array<{ studentId: string }> })
      .data;
    expect(inserted.map((row) => row.studentId)).toEqual(['SE1', 'SE3']);
  });

  it('treats a student ID repeated inside the rows as a duplicate of the first', async () => {
    const { service } = build();
    const result = await service.importRows(GUILD, [person('SE1', ANN), person('SE1', BOB)], ACTOR);
    expect(result).toMatchObject({ added: 1, duplicates: ['SE1'] });
  });

  it('records one audit row with the counts, in the same transaction', async () => {
    const { service, audit } = build({ existing: ['SE2'] });
    await service.importRows(GUILD, rows, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.birthdayImport,
        params: { count: 2, total: 3, skipped: 1 },
      },
      expect.anything(),
    );
  });

  it('writes no audit row when nothing was added', async () => {
    const { service, audit } = build({ existing: ['SE1', 'SE2', 'SE3'] });
    await expect(service.importRows(GUILD, rows, ACTOR)).resolves.toMatchObject({ added: 0 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('with dryRun reports what would be added and writes nothing', async () => {
    const { service, prisma, entry, audit, guilds } = build({ existing: ['SE2'] });
    const result = await service.importRows(GUILD, rows, ACTOR, { dryRun: true });
    expect(result).toEqual({
      dryRun: true,
      total: 3,
      added: 2,
      duplicates: ['SE2'],
      sample: ['SE1', 'SE3'],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(guilds.ensureGuild).not.toHaveBeenCalled();
    expect(entry.createMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('names at most ten people in the sample and still counts them all', async () => {
    const many = Array.from({ length: 25 }, (_, i) => person(`SE${i}`, ANN));
    const { service } = build();
    const result = await service.importRows(GUILD, many, ACTOR, { dryRun: true });
    expect(result.added).toBe(25);
    expect(result.sample).toHaveLength(10);
  });

  it('does nothing for an empty list', async () => {
    const { service, prisma } = build();
    await expect(service.importRows(GUILD, [], ACTOR)).resolves.toEqual({
      dryRun: false,
      total: 0,
      added: 0,
      duplicates: [],
      sample: [],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses rows that are not people', async () => {
    const { service, prisma } = build();
    await expect(
      service.importRows(GUILD, [{ ...person('SE1', ANN), month: 2, day: 30 }], ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(service.importRows(GUILD, 'rows', ACTOR)).rejects.toBeInstanceOf(ServiceError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('BirthdayService.list and add', () => {
  it('refuses a month outside 1..12', async () => {
    const { service } = build();
    await expect(service.list(GUILD, { month: 13 })).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.list(GUILD, { month: 1.5 })).rejects.toBeInstanceOf(ServiceError);
  });

  it('answers DUPLICATE_ID without an audit row when the student ID exists', async () => {
    const { service, entry, audit } = build();
    entry.createMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.add(GUILD, person('SE1', ANN), ACTOR)).resolves.toEqual({
      code: 'DUPLICATE_ID',
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('adds a person and audits it', async () => {
    const { service, audit } = build();
    await expect(service.add(GUILD, person('SE1', ANN), ACTOR)).resolves.toEqual({ code: 'ADDED' });
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.birthdayAdd,
        params: { userId: ANN, month: 3, day: 15 },
      },
      expect.anything(),
    );
  });
});

describe('BirthdayService.runDailyWishes', () => {
  const DAY = { year: 2026, month: 3, day: 15 };

  function runBuild(options: { channelId: string | null; fetchGuild: () => Promise<unknown> }) {
    const created = vi.fn();
    const prisma = {
      birthdayEntry: {
        findMany: vi.fn().mockResolvedValue([
          {
            discordId: ANN,
            guild: {
              id: 'internal-guild',
              discordId: GUILD,
              config: { birthdayChannelId: options.channelId },
            },
          },
        ]),
      },
      birthdayCompletedDate: { createMany: created },
    };
    const reporter = { report: vi.fn() };
    const service = new BirthdayService(
      prisma as unknown as PrismaService,
      { record: vi.fn() } as unknown as AuditService,
      {} as GuildConfigService,
      { guilds: { fetch: options.fetchGuild }, channels: { fetch: vi.fn() } } as never,
      reporter as unknown as ErrorReporter,
      { isStopping: () => false } as unknown as DiscordReadyService,
    );
    return { service, created, reporter };
  }

  it('skips a server with no birthday channel without taking its lease', async () => {
    const { service, created } = runBuild({ channelId: null, fetchGuild: vi.fn() });
    await expect(service.runDailyWishes(DAY)).resolves.toMatchObject({
      guilds: 1,
      sent: 0,
      failed: 0,
    });
    expect(created).not.toHaveBeenCalled();
  });

  it('skips a server the bot was removed from (Unknown Guild) with a warning, not a failure', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service, created, reporter } = runBuild({
      channelId: '400000000000000001',
      fetchGuild: () => Promise.reject(Object.assign(new Error('Unknown Guild'), { code: 10004 })),
    });
    await expect(service.runDailyWishes(DAY)).resolves.toMatchObject({ sent: 0, failed: 0 });
    expect(created).not.toHaveBeenCalled();
    expect(reporter.report).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(GUILD));
  });

  it('counts any other Discord failure as a failed server and reports it', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, reporter } = runBuild({
      channelId: '400000000000000001',
      fetchGuild: () => Promise.reject(Object.assign(new Error('boom'), { code: 50013 })),
    });
    const summary = await service.runDailyWishes(DAY);
    expect(summary.failed).toBe(1);
    expect(summary.retryAt).toBeInstanceOf(Date);
    expect(reporter.report).toHaveBeenCalledTimes(1);
  });

  it('refuses a day the calendar lacks', async () => {
    const { service } = runBuild({ channelId: null, fetchGuild: vi.fn() });
    await expect(service.runDailyWishes({ year: 2023, month: 2, day: 29 })).rejects.toThrow();
  });
});
