import {
  AUDIT_ACTIONS,
  BIRTHDAY_WISHES,
  BIRTHDAY_WISHES_MAX,
  type ActorContext,
} from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { BirthdayWishService } from './birthday-wish.service.js';

const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };

/** The built-in wishes as a new server's list holds them: trimmed, each text once, in order. */
const BUILT_IN = [...new Set(BIRTHDAY_WISHES.map((wish) => wish.trim()))];

describe('BirthdayWishService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let audit: AuditService;
  let guilds: GuildConfigService;
  let service: BirthdayWishService;
  let nextGuild = 300000000000000100n;

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    guilds = new GuildConfigService(prisma, audit, access);
    service = new BirthdayWishService(prisma, audit, guilds);
  });

  afterAll(async () => {
    await database.dispose();
  });

  /** A server the bot knows, by Discord id and internal key. */
  async function newGuild(): Promise<{ guildId: string; internalId: string }> {
    const guildId = String((nextGuild += 1n));
    const guild = await guilds.ensureGuild(guildId);
    return { guildId, internalId: guild.id };
  }

  describe('list', () => {
    it('fills a new server with the built-in wishes once, in order and without repeats', async () => {
      const { guildId } = await newGuild();
      const first = await service.list(guildId);
      expect(first.map((wish) => wish.text)).toEqual(BUILT_IN);
      expect(first.every((wish) => !wish.used)).toBe(true);
      await expect(service.list(guildId)).resolves.toEqual(first);
    });

    it('fills a server only once when two readers arrive together', async () => {
      const { guildId } = await newGuild();
      const [a, b] = await Promise.all([service.list(guildId), service.list(guildId)]);
      expect(a).toHaveLength(BUILT_IN.length);
      expect(b).toEqual(a);
    });

    it('keeps an emptied list empty', async () => {
      const { guildId } = await newGuild();
      for (const wish of await service.list(guildId)) await service.remove(guildId, wish.id, ACTOR);
      await expect(service.list(guildId)).resolves.toEqual([]);
    });

    it('carries the cycle a server was in over from the legacy usage rows', async () => {
      const { guildId, internalId } = await newGuild();
      await prisma.birthdayWishUsage.createMany({
        data: [0, 1].map((wishIndex) => ({ guildId: internalId, wishIndex })),
      });
      const wishes = await service.list(guildId);
      const used = wishes.filter((wish) => wish.used).map((wish) => wish.text);
      expect(used).toEqual([BIRTHDAY_WISHES[0], BIRTHDAY_WISHES[1]].map((wish) => wish?.trim()));
    });

    it('starts a fresh cycle when the legacy rows say every built-in was sent', async () => {
      const { guildId, internalId } = await newGuild();
      await prisma.birthdayWishUsage.createMany({
        data: BIRTHDAY_WISHES.map((_, wishIndex) => ({ guildId: internalId, wishIndex })),
      });
      const wishes = await service.list(guildId);
      expect(wishes.some((wish) => wish.used)).toBe(false);
    });
  });

  describe('create, update, remove', () => {
    it('adds, rewrites and removes a wish, each with an audit row naming it', async () => {
      const { guildId } = await newGuild();
      const added = await service.create(guildId, { text: '  Chúc ${name} vui!  ' }, ACTOR);
      expect(added).toMatchObject({ text: 'Chúc ${name} vui!', used: false });
      const listed = await service.list(guildId);
      expect(listed.at(-1)).toEqual(added);

      const edited = await service.update(guildId, added.id, { text: 'Mừng ${name}!' }, ACTOR);
      expect(edited).toEqual({ ...added, text: 'Mừng ${name}!' });

      await service.remove(guildId, added.id, ACTOR);
      expect((await service.list(guildId)).map((wish) => wish.id)).not.toContain(added.id);

      for (const action of [
        AUDIT_ACTIONS.birthdayWishCreate,
        AUDIT_ACTIONS.birthdayWishUpdate,
        AUDIT_ACTIONS.birthdayWishRemove,
      ]) {
        const page = await audit.list({ guildId, action });
        expect(page.items, action).toHaveLength(1);
        expect(page.items[0]?.params).toEqual({ wishId: added.id });
      }
    });

    it('refuses a wish without the name placeholder or with it too often', async () => {
      const { guildId } = await newGuild();
      await expect(service.create(guildId, { text: 'Chúc mừng!' }, ACTOR)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      await expect(
        service.create(guildId, { text: '${name} '.repeat(6) }, ACTOR),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('answers BIRTHDAY_WISH_NOT_FOUND for a wish of another server or a malformed id', async () => {
      const mine = await newGuild();
      const other = await newGuild();
      const wish = await service.create(mine.guildId, { text: 'Hi ${name}' }, ACTOR);
      await expect(
        service.update(other.guildId, wish.id, { text: 'Yo ${name}' }, ACTOR),
      ).rejects.toMatchObject({ code: 'BIRTHDAY_WISH_NOT_FOUND' });
      await expect(service.remove(other.guildId, wish.id, ACTOR)).rejects.toMatchObject({
        code: 'BIRTHDAY_WISH_NOT_FOUND',
      });
      await expect(service.remove(mine.guildId, 'not-a-uuid', ACTOR)).rejects.toMatchObject({
        code: 'BIRTHDAY_WISH_NOT_FOUND',
      });
    });

    it('stops at the most wishes one server keeps', async () => {
      const { guildId, internalId } = await newGuild();
      await service.list(guildId);
      const room = BIRTHDAY_WISHES_MAX - BUILT_IN.length;
      await prisma.birthdayWish.createMany({
        data: Array.from({ length: room }, (_, i) => ({
          guildId: internalId,
          text: `${i} \${name}`,
        })),
      });
      await expect(
        service.create(guildId, { text: 'One more ${name}' }, ACTOR),
      ).rejects.toMatchObject({
        code: 'BIRTHDAY_WISH_LIMIT_REACHED',
        params: { max: BIRTHDAY_WISHES_MAX },
      });
    });

    it('has the database refuse a wish that never mentions the celebrant', async () => {
      const { internalId } = await newGuild();
      await expect(
        prisma.birthdayWish.create({ data: { guildId: internalId, text: 'No mention' } }),
      ).rejects.toThrow();
    });
  });

  describe('pickFor', () => {
    it('never repeats within a cycle, then starts a new one', async () => {
      const { internalId } = await newGuild();
      const firstCycle: string[] = [];
      for (let i = 0; i < BUILT_IN.length; i++) firstCycle.push(await service.pickFor(internalId));
      expect(new Set(firstCycle)).toEqual(new Set(BUILT_IN));

      const secondCycle: string[] = [];
      for (let i = 0; i < BUILT_IN.length; i++) secondCycle.push(await service.pickFor(internalId));
      expect(new Set(secondCycle)).toEqual(new Set(BUILT_IN));
    });

    it('sends a wish added mid-cycle within the same cycle', async () => {
      const { guildId, internalId } = await newGuild();
      await service.pickFor(internalId);
      const added = await service.create(guildId, { text: 'Brand new ${name}' }, ACTOR);
      const rest: string[] = [];
      for (let i = 0; i < BUILT_IN.length; i++) rest.push(await service.pickFor(internalId));
      expect(rest).toContain(added.text);
    });

    it('does not hand the same wish to concurrent pickers', async () => {
      const { internalId } = await newGuild();
      const picks = await Promise.all(Array.from({ length: 4 }, () => service.pickFor(internalId)));
      expect(new Set(picks).size).toBe(4);
    });

    it('chooses among the unused wishes at random, not in order', async () => {
      const firsts = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const { internalId } = await newGuild();
        firsts.add(await service.pickFor(internalId));
      }
      expect(firsts.size).toBeGreaterThan(5);
    });

    it('falls back to a built-in wish when the server emptied its list', async () => {
      const { guildId, internalId } = await newGuild();
      for (const wish of await service.list(guildId)) await service.remove(guildId, wish.id, ACTOR);
      expect(BIRTHDAY_WISHES).toContain(await service.pickFor(internalId));
    });
  });
});
