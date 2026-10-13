import { AUDIT_ACTIONS, BIRTHDAY_WISHES, renderBirthdayWish, type ActorContext } from '@sab/shared';
import type { Client } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { ErrorReporter } from '../../discord/error-reporter.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { dateColumnValue, type BusinessDay } from './birthday.date.js';
import { RUN_LEASE_MS, BirthdayService } from './birthday.service.js';

const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const YEAR = 2026;

type Sent = { channelId: string; content: string; allowedMentions: { users: string[] } };

describe('BirthdayService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let audit: AuditService;
  let guilds: GuildConfigService;
  let service: BirthdayService;
  let nextGuild = 100000000000000100n;
  let nextChannel = 200000000000000100n;
  let nextUser = 500000000000000000n;
  let nextSlot = 0;

  // Every test greets on a day of its own: a run looks at every server in the
  // schema, so two tests sharing a birthday would greet each other's people.
  // Only even days are handed out; the odd day before one is free for tests of
  // a run left over from the day before.
  function freshDay(): BusinessDay {
    const slot = nextSlot++;
    return { year: YEAR, month: 1 + (slot % 12), day: 4 + 2 * Math.floor(slot / 12) };
  }

  // What the fake Discord saw and how it should misbehave.
  const sent: Sent[] = [];
  const failAfter = new Map<string, number>();
  const removedGuilds = new Set<string>();
  const unsendable = new Set<string>();
  const state = { stopping: false, stopWhen: undefined as (() => boolean) | undefined };
  const report = vi.fn().mockResolvedValue(undefined);

  const sentTo = (channelId: string) => sent.filter((message) => message.channelId === channelId);

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    guilds = new GuildConfigService(prisma, audit, access);

    const client = {
      guilds: {
        fetch: (id: string) =>
          removedGuilds.has(id)
            ? Promise.reject(Object.assign(new Error('Unknown Guild'), { code: 10004 }))
            : Promise.resolve({ id }),
      },
      channels: {
        fetch: (channelId: string) =>
          Promise.resolve({
            isSendable: () => !unsendable.has(channelId),
            send: (message: Omit<Sent, 'channelId'>) => {
              const allowed = failAfter.get(channelId);
              if (allowed !== undefined && sentTo(channelId).length >= allowed) {
                return Promise.reject(new Error('Missing Permissions'));
              }
              sent.push({ channelId, ...message });
              return Promise.resolve({});
            },
          }),
      },
    } as unknown as Client;

    service = new BirthdayService(
      prisma,
      audit,
      guilds,
      client,
      { report } as unknown as ErrorReporter,
      {
        isStopping: () => state.stopping || (state.stopWhen?.() ?? false),
      } as unknown as DiscordReadyService,
    );
  });

  beforeEach(() => {
    sent.length = 0;
    failAfter.clear();
    removedGuilds.clear();
    unsendable.clear();
    state.stopping = false;
    state.stopWhen = undefined;
    report.mockClear();
  });

  afterAll(async () => {
    await database.dispose();
  });

  async function seed(
    count: number,
    options: { on?: { month: number; day: number }; channel?: boolean } = {},
  ) {
    const today = options.on === undefined ? freshDay() : { year: YEAR, ...options.on };
    const on = options.on ?? today;
    const guildId = String((nextGuild += 1n));
    const channelId = String((nextChannel += 1n));
    if (options.channel === false) await guilds.ensureGuild(guildId);
    else await guilds.patch(guildId, { birthdayChannelId: channelId }, ACTOR);
    const rows = Array.from({ length: count }, (_, i) => ({
      studentId: `${guildId.slice(-4)}-${i}`,
      name: `Person ${i}`,
      discordId: String((nextUser += 1n)),
      month: on.month,
      day: on.day,
    }));
    await service.importRows(guildId, rows, ACTOR);
    // The order the day's greetings go out in is the order the list prints.
    const ids = (await service.list(guildId)).map((entry) => entry.discordId);
    return { guildId, channelId, ids, today };
  }

  /** A seed whose people are greeted on `today`, for tests that need several servers on one day. */
  const seedOn = (count: number, today: BusinessDay, options: { channel?: boolean } = {}) =>
    seed(count, { on: today, ...options });

  const runRow = (guildId: string) =>
    prisma.birthdayCompletedDate.findFirstOrThrow({ where: { guild: { discordId: guildId } } });

  describe('the list', () => {
    it('merges an import, skipping student IDs it already has, and orders by month, day, then arrival', async () => {
      const { guildId } = await seed(0);
      const person = (studentId: string, month: number, day: number, discordId: string) => ({
        studentId,
        name: studentId,
        discordId,
        month,
        day,
      });
      await service.importRows(
        guildId,
        [
          person('B', 3, 15, '600000000000000002'),
          person('A', 1, 5, '600000000000000001'),
          person('C', 3, 15, '600000000000000003'),
        ],
        ACTOR,
      );
      const again = await service.importRows(
        guildId,
        [person('A', 12, 31, '600000000000000009'), person('D', 3, 2, '600000000000000004')],
        ACTOR,
      );
      expect(again).toMatchObject({ added: 1, duplicates: ['A'] });

      const list = await service.list(guildId);
      expect(list.map((entry) => entry.studentId)).toEqual(['A', 'D', 'B', 'C']);
      // The skipped row did not overwrite the one already there.
      expect(list[0]).toMatchObject({ month: 1, day: 5, discordId: '600000000000000001' });
      expect((await service.list(guildId, { month: 3 })).map((entry) => entry.studentId)).toEqual([
        'D',
        'B',
        'C',
      ]);
      expect(Object.keys(list[0] ?? {}).sort()).toEqual(
        ['day', 'discordId', 'month', 'name', 'studentId'].sort(),
      );
    });

    it('audits an import with its counts, and a dry run leaves no trace', async () => {
      const { guildId } = await seed(2);
      const before = await prisma.birthdayEntry.count({ where: { guild: { discordId: guildId } } });
      const plan = await service.importRows(
        guildId,
        [
          {
            studentId: 'NEW',
            name: 'New',
            discordId: '600000000000000010',
            month: 6,
            day: 1,
          },
        ],
        ACTOR,
        { dryRun: true },
      );
      expect(plan).toMatchObject({ dryRun: true, added: 1 });
      await expect(
        prisma.birthdayEntry.count({ where: { guild: { discordId: guildId } } }),
      ).resolves.toBe(before);

      const page = await audit.list({ guildId, action: AUDIT_ACTIONS.birthdayImport });
      expect(page.items.map((item) => item.params)).toEqual([{ count: 2, total: 2, skipped: 0 }]);
    });

    it('removes by student ID or by user, previews first, and audits only the real removal', async () => {
      const { guildId, ids } = await seed(3);
      const [first] = ids;
      const students = await service.list(guildId);
      const firstStudent = students[0]?.studentId ?? '';

      const plan = await service.remove(guildId, { discordId: first }, ACTOR, { dryRun: true });
      expect(plan).toMatchObject({ dryRun: true, code: 'REMOVED_BY_USER', count: 1 });
      await expect(service.list(guildId)).resolves.toHaveLength(3);

      const byStudent = await service.remove(
        guildId,
        { studentId: firstStudent, discordId: ids[2] },
        ACTOR,
      );
      expect(byStudent).toMatchObject({ code: 'REMOVED_BY_STUDENT', count: 1 });
      await expect(service.list(guildId)).resolves.toHaveLength(2);

      await expect(
        service.remove(guildId, { studentId: firstStudent }, ACTOR),
      ).resolves.toMatchObject({ code: 'NOT_FOUND', count: 0 });
      const byUser = await service.remove(guildId, { discordId: ids[1] }, ACTOR);
      expect(byUser).toMatchObject({ code: 'REMOVED_BY_USER', count: 1 });

      const page = await audit.list({ guildId, action: AUDIT_ACTIONS.birthdayRemove });
      expect(page.items).toHaveLength(2);
    });

    it('adds one person and refuses the same student ID twice', async () => {
      const { guildId } = await seed(0);
      const person = {
        studentId: 'ONE',
        name: 'One',
        discordId: '600000000000000020',
        month: 7,
        day: 7,
      };
      await expect(service.add(guildId, person, ACTOR)).resolves.toEqual({ code: 'ADDED' });
      await expect(service.add(guildId, person, ACTOR)).resolves.toEqual({
        code: 'DUPLICATE_ID',
      });
      await expect(service.list(guildId)).resolves.toHaveLength(1);
      const page = await audit.list({ guildId, action: AUDIT_ACTIONS.birthdayAdd });
      expect(page.items).toHaveLength(1);
    });
  });

  describe('pickWish', () => {
    it('never repeats within a cycle, then starts a new one', async () => {
      const { guildId } = await seed(0);
      const total = BIRTHDAY_WISHES.length;
      const firstCycle: number[] = [];
      for (let i = 0; i < total; i++) firstCycle.push(await service.pickWish(guildId));
      expect(new Set(firstCycle).size).toBe(total);
      expect(Math.min(...firstCycle)).toBe(0);
      expect(Math.max(...firstCycle)).toBe(total - 1);

      const secondCycle: number[] = [];
      for (let i = 0; i < total; i++) secondCycle.push(await service.pickWish(guildId));
      expect(new Set(secondCycle).size).toBe(total);

      // Twenty-one picks in a row on a fresh server: no value out of range, no failure.
      const other = (await seed(0)).guildId;
      const picks: number[] = [];
      for (let i = 0; i < total + 1; i++) picks.push(await service.pickWish(other));
      expect(picks.every((pick) => pick >= 0 && pick < total)).toBe(true);
    });

    it('does not hand the same wish to concurrent pickers', async () => {
      const { guildId } = await seed(0);
      const picks = await Promise.all(Array.from({ length: 4 }, () => service.pickWish(guildId)));
      expect(new Set(picks).size).toBe(4);
    });

    it('chooses among the unused wishes at random, not in order', async () => {
      const firsts = new Set<number>();
      for (let i = 0; i < 40; i++) {
        const { guildId } = await seed(0);
        firsts.add(await service.pickWish(guildId));
      }
      expect(firsts.size).toBeGreaterThan(5);
    });

    it('answers GUILD_NOT_FOUND for a server nobody recorded', async () => {
      await expect(service.pickWish('199999999999999999')).rejects.toMatchObject({
        code: 'GUILD_NOT_FOUND',
      });
    });
  });

  describe('runDailyWishes', () => {
    it('sends one message per person, mentioning them and nobody else, then marks the day done', async () => {
      const { guildId, channelId, ids, today } = await seed(3);
      const summary = await service.runDailyWishes(today);
      expect(summary).toMatchObject({ sent: 3, failed: 0, retryAt: null });

      const messages = sentTo(channelId);
      expect(messages).toHaveLength(3);
      messages.forEach((message, index) => {
        const id = ids[index];
        expect(BIRTHDAY_WISHES.map((_, wish) => renderBirthdayWish(wish, `<@${id}>`))).toContain(
          message.content,
        );
        expect(message.content).not.toContain('${name}');
        expect(message.allowedMentions).toEqual({ users: [id] });
      });
      const row = await runRow(guildId);
      expect(row).toMatchObject({ status: 'DONE', leaseUntil: null });
      expect(row.sentDiscordIds).toEqual(ids);
      expect(row.doneAt).toBeInstanceOf(Date);

      const stored = await prisma.$queryRaw<Array<{ date: string }>>`
        SELECT "date"::text AS date FROM "BirthdayCompletedDate" WHERE id = ${row.id}::uuid`;
      expect(stored).toEqual([{ date: dateColumnValue(today).toISOString().slice(0, 10) }]);

      const page = await audit.list({ guildId, action: AUDIT_ACTIONS.birthdayWish });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        source: 'SYSTEM',
        ok: true,
        params: { count: 3, total: 3 },
      });
    });

    it('greets a person once a day even when the list holds them twice', async () => {
      const { guildId, channelId, today } = await seed(1);
      const [only] = await service.list(guildId);
      await service.add(guildId, { ...only, studentId: 'SECOND' }, ACTOR);
      await service.runDailyWishes(today);
      expect(sentTo(channelId)).toHaveLength(1);
    });

    it('does nothing for a server with nobody today, or no birthday channel', async () => {
      const today = freshDay();
      const quiet = await seed(2, { on: { month: today.month, day: today.day + 1 } });
      const noChannel = await seedOn(2, today, { channel: false });
      await service.runDailyWishes(today);
      expect(sentTo(quiet.channelId)).toHaveLength(0);
      expect(sentTo(noChannel.channelId)).toHaveLength(0);
      await expect(
        prisma.birthdayCompletedDate.count({
          where: { guild: { discordId: { in: [quiet.guildId, noChannel.guildId] } } },
        }),
      ).resolves.toBe(0);
    });

    it('lets exactly one of several simultaneous runs send, and every person is greeted once', async () => {
      const { guildId, channelId, ids, today } = await seed(7);
      const summaries = await Promise.all(
        Array.from({ length: 4 }, () => service.runDailyWishes(today)),
      );
      expect(sentTo(channelId)).toHaveLength(7);
      expect(new Set(sentTo(channelId).map((message) => message.allowedMentions.users[0]))).toEqual(
        new Set(ids),
      );
      expect(summaries.reduce((total, summary) => total + summary.sent, 0)).toBe(7);
      expect(summaries.filter((summary) => summary.sent > 0)).toHaveLength(1);
      await expect(
        prisma.birthdayCompletedDate.count({ where: { guild: { discordId: guildId } } }),
      ).resolves.toBe(1);
    });

    it('sends nothing on a second run of a finished day', async () => {
      const { channelId, today } = await seed(2);
      await service.runDailyWishes(today);
      sent.length = 0;
      await expect(service.runDailyWishes(today)).resolves.toMatchObject({
        sent: 0,
        retryAt: null,
      });
      expect(sentTo(channelId)).toHaveLength(0);
    });

    it('sends nothing while somebody else holds a live lease, and says when to look again', async () => {
      const { guildId, channelId, today } = await seed(2);
      const lease = new Date(Date.now() + RUN_LEASE_MS);
      const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
      await prisma.birthdayCompletedDate.create({
        data: {
          guildId: guild.id,
          date: dateColumnValue(today),
          status: 'SENDING',
          leaseUntil: lease,
        },
      });
      const summary = await service.runDailyWishes(today);
      expect(summary.sent).toBe(0);
      expect(summary.retryAt?.getTime()).toBe(lease.getTime());
      expect(sentTo(channelId)).toHaveLength(0);
    });

    it('keeps the day SENDING with exactly the people already greeted when a send fails, and finishes it on the next run', async () => {
      const { guildId, channelId, ids, today } = await seed(7);
      failAfter.set(channelId, 2);
      const failed = await service.runDailyWishes(today);
      expect(failed).toMatchObject({ sent: 2, failed: 1 });
      expect(failed.retryAt).toBeInstanceOf(Date);

      const row = await runRow(guildId);
      expect(row.status).toBe('SENDING');
      expect(row.sentDiscordIds).toEqual(ids.slice(0, 2));
      expect(row.leaseUntil && row.leaseUntil.getTime()).toBeLessThanOrEqual(Date.now());
      expect(report).toHaveBeenCalledTimes(1);
      const trail = await audit.list({ guildId, action: AUDIT_ACTIONS.birthdayWish });
      expect(trail.items).toHaveLength(1);
      expect(trail.items[0]).toMatchObject({ source: 'SYSTEM', ok: false });
      expect(trail.items[0]?.error).toContain('Error');

      failAfter.clear();
      const resumed = await service.runDailyWishes(today);
      expect(resumed).toMatchObject({ sent: 5, failed: 0 });
      const greeted = sentTo(channelId).map((message) => message.allowedMentions.users[0]);
      expect(greeted).toEqual(ids);
      await expect(runRow(guildId)).resolves.toMatchObject({ status: 'DONE', sentDiscordIds: ids });
    });

    it('carries on after a process died mid-run: only the people not yet greeted, none twice', async () => {
      const { guildId, channelId, ids, today } = await seed(7);
      const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
      // What a killed process leaves behind: 3 of 7 recorded, the lease still ticking.
      const lease = new Date(Date.now() + RUN_LEASE_MS);
      const run = await prisma.birthdayCompletedDate.create({
        data: {
          guildId: guild.id,
          date: dateColumnValue(today),
          status: 'SENDING',
          leaseUntil: lease,
          sentDiscordIds: ids.slice(0, 3),
        },
      });

      const early = await service.runDailyWishes(today);
      expect(early.sent).toBe(0);
      expect(early.retryAt?.getTime()).toBe(lease.getTime());

      await prisma.birthdayCompletedDate.update({
        where: { id: run.id },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });
      const late = await service.runDailyWishes(today);
      expect(late).toMatchObject({ sent: 4, failed: 0 });
      expect(sentTo(channelId).map((message) => message.allowedMentions.users[0])).toEqual(
        ids.slice(3),
      );
      await expect(runRow(guildId)).resolves.toMatchObject({ status: 'DONE', sentDiscordIds: ids });
    });

    it('releases its lease and stops when shutdown begins, so the next start resumes at once', async () => {
      const { guildId, channelId, ids, today } = await seed(4);
      state.stopWhen = () => sentTo(channelId).length >= 2;
      await service.runDailyWishes(today);
      state.stopWhen = undefined;
      expect(sentTo(channelId)).toHaveLength(2);
      const row = await runRow(guildId);
      expect(row.status).toBe('SENDING');
      expect(row.sentDiscordIds).toEqual(ids.slice(0, 2));

      await service.runDailyWishes(today);
      expect(sentTo(channelId).map((message) => message.allowedMentions.users[0])).toEqual(ids);
    });

    it('greets 29 February people on 28 February only in a year without a 29th', async () => {
      const { channelId, ids } = await seed(1, { on: { month: 2, day: 29 } });
      await service.runDailyWishes({ year: 2024, month: 2, day: 28 });
      expect(sentTo(channelId)).toHaveLength(0);
      await service.runDailyWishes({ year: 2023, month: 2, day: 28 });
      expect(sentTo(channelId).map((message) => message.allowedMentions.users[0])).toEqual(ids);
      await service.runDailyWishes({ year: 2024, month: 2, day: 29 });
      expect(sentTo(channelId)).toHaveLength(2);
    });

    it('skips a server the bot left without failing, and keeps going with the others', async () => {
      const today = freshDay();
      const gone = await seedOn(1, today);
      const here = await seedOn(1, today);
      removedGuilds.add(gone.guildId);
      const summary = await service.runDailyWishes(today);
      expect(summary).toMatchObject({ failed: 0 });
      expect(sentTo(gone.channelId)).toHaveLength(0);
      expect(sentTo(here.channelId)).toHaveLength(1);
      await expect(
        prisma.birthdayCompletedDate.count({ where: { guild: { discordId: gone.guildId } } }),
      ).resolves.toBe(0);
    });

    it('lets one server fail without stopping the others', async () => {
      const today = freshDay();
      const broken = await seedOn(2, today);
      const fine = await seedOn(2, today);
      unsendable.add(broken.channelId);
      const summary = await service.runDailyWishes(today);
      expect(summary.failed).toBe(1);
      expect(sentTo(fine.channelId)).toHaveLength(2);
      await expect(runRow(fine.guildId)).resolves.toMatchObject({ status: 'DONE' });
      expect(report).toHaveBeenCalledTimes(1);
    });
  });

  describe('recoverStaleRuns', () => {
    // The day before `today`: seeds are greeted on it, the run row is dated by it.
    const eveOf = (today: BusinessDay) => ({ month: today.month, day: today.day - 1 });
    const eveDate = (today: BusinessDay) => dateColumnValue({ ...today, day: today.day - 1 });

    it('finishes a previous day that was left half done', async () => {
      const today = freshDay();
      const { guildId, channelId, ids } = await seed(3, { on: eveOf(today) });
      const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
      await prisma.birthdayCompletedDate.create({
        data: {
          guildId: guild.id,
          date: eveDate(today),
          status: 'SENDING',
          leaseUntil: new Date(Date.now() - 1000),
          sentDiscordIds: ids.slice(0, 1),
        },
      });
      await expect(service.recoverStaleRuns(today)).resolves.toMatchObject({ sent: 2, failed: 0 });
      expect(sentTo(channelId).map((message) => message.allowedMentions.users[0])).toEqual(
        ids.slice(1),
      );
      await expect(runRow(guildId)).resolves.toMatchObject({ status: 'DONE' });
    });

    it('never starts a previous day that was not started', async () => {
      const today = freshDay();
      const { channelId } = await seed(2, { on: eveOf(today) });
      await expect(service.recoverStaleRuns(today)).resolves.toMatchObject({ guilds: 0, sent: 0 });
      expect(sentTo(channelId)).toHaveLength(0);
    });

    it('leaves a finished previous day alone', async () => {
      const today = freshDay();
      const { guildId, channelId, ids } = await seed(1, { on: eveOf(today) });
      const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: guildId } });
      await prisma.birthdayCompletedDate.create({
        data: { guildId: guild.id, date: eveDate(today), status: 'DONE', sentDiscordIds: ids },
      });
      await service.recoverStaleRuns(today);
      expect(sentTo(channelId)).toHaveLength(0);
    });
  });
});
