import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  BIRTHDAY_WISHES,
  BIRTHDAY_WISHES_MAX,
  BirthdayWishIdParamSchema,
  BirthdayWishInputSchema,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type BirthdayWishView,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';

type Tx = Prisma.TransactionClient;

const WISH_VIEW = { id: true, text: true, used: true } satisfies Prisma.BirthdayWishSelect;

/** Another picker can hold the only unused wish for a moment; a few rounds settle it. */
const MAX_ROUNDS = 5;

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function parseText(input: unknown): string {
  const parsed = BirthdayWishInputSchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data.text;
}

function parseWishId(id: string): string {
  const parsed = BirthdayWishIdParamSchema.safeParse({ id });
  if (!parsed.success) throw new ServiceError(ErrorCode.BIRTHDAY_WISH_NOT_FOUND);
  return parsed.data.id;
}

/** A built-in wish at random, for a server whose own list is empty. */
function builtInWish(): string {
  const wish = BIRTHDAY_WISHES[randomInt(BIRTHDAY_WISHES.length)];
  if (wish === undefined) throw new Error('There are no built-in birthday wishes');
  return wish;
}

/**
 * Every wish-list change, the first fill and each pick of one server run one
 * after another: the server's settings row is locked for the transaction, and
 * whether its list was filled yet is read under that lock. Only that row is
 * locked, before anything else, so the order matches the settings update
 * (settings row, then the server row) and the two cannot deadlock.
 */
async function lockWishes(tx: Tx, guildId: string): Promise<{ seeded: boolean }> {
  await tx.guildConfig.createMany({ data: [{ guildId }], skipDuplicates: true });
  const rows = await tx.$queryRaw<Array<{ seeded: boolean }>>`
    SELECT "birthdayWishesSeeded" AS seeded FROM "GuildConfig"
    WHERE "guildId" = ${guildId}::uuid
    FOR NO KEY UPDATE
  `;
  return { seeded: rows[0]?.seeded ?? false };
}

/**
 * The server's own wishes, kept in the database so the dashboard can edit
 * them. A server starts with the built-in wishes, copied in the first time its
 * list is read or a wish is picked for it; from then on the list is only what
 * its admins make of it, and emptying it does not bring the built-ins back.
 *
 * A wish is sent at most once per cycle: picking marks it `used`, and when
 * every wish of the server is used they are all cleared and the next cycle
 * begins. A wish added mid-cycle is unused, so it joins the current one.
 */
@Injectable()
export class BirthdayWishService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
  ) {}

  /** The server's wishes, oldest first. */
  async list(guildId: string): Promise<BirthdayWishView[]> {
    const id = parseGuildId(guildId);
    return this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await this.ensureSeeded(tx, guild.id);
      return tx.birthdayWish.findMany({
        where: { guildId: guild.id },
        select: WISH_VIEW,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
    });
  }

  /** Adds a wish; `BIRTHDAY_WISH_LIMIT_REACHED` once the server has the most it may keep. */
  async create(guildId: string, input: unknown, actor: ActorContext): Promise<BirthdayWishView> {
    const id = parseGuildId(guildId);
    const text = parseText(input);
    return this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await this.ensureSeeded(tx, guild.id);
      const count = await tx.birthdayWish.count({ where: { guildId: guild.id } });
      if (count >= BIRTHDAY_WISHES_MAX) {
        throw new ServiceError(ErrorCode.BIRTHDAY_WISH_LIMIT_REACHED, { max: BIRTHDAY_WISHES_MAX });
      }
      const wish = await tx.birthdayWish.create({
        data: { guildId: guild.id, text },
        select: WISH_VIEW,
      });
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.birthdayWishCreate,
          params: { wishId: wish.id },
        },
        tx,
      );
      return wish;
    });
  }

  /** Rewrites a wish's text; whether it was sent in this cycle stays as it was. */
  async update(
    guildId: string,
    wishId: string,
    input: unknown,
    actor: ActorContext,
  ): Promise<BirthdayWishView> {
    const id = parseGuildId(guildId);
    const wish = parseWishId(wishId);
    const text = parseText(input);
    return this.prisma.$transaction(async (tx) => {
      await this.lockKnownGuild(tx, id);
      const changed = await tx.birthdayWish.updateMany({
        where: { id: wish, guild: { discordId: id } },
        data: { text },
      });
      if (changed.count === 0) throw new ServiceError(ErrorCode.BIRTHDAY_WISH_NOT_FOUND);
      await this.audit.record(
        { guildId: id, actor, action: AUDIT_ACTIONS.birthdayWishUpdate, params: { wishId: wish } },
        tx,
      );
      return tx.birthdayWish.findUniqueOrThrow({ where: { id: wish }, select: WISH_VIEW });
    });
  }

  async remove(guildId: string, wishId: string, actor: ActorContext): Promise<void> {
    const id = parseGuildId(guildId);
    const wish = parseWishId(wishId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockKnownGuild(tx, id);
      const removed = await tx.birthdayWish.deleteMany({
        where: { id: wish, guild: { discordId: id } },
      });
      if (removed.count === 0) throw new ServiceError(ErrorCode.BIRTHDAY_WISH_NOT_FOUND);
      await this.audit.record(
        { guildId: id, actor, action: AUDIT_ACTIONS.birthdayWishRemove, params: { wishId: wish } },
        tx,
      );
    });
  }

  /**
   * The text of a wish this server has not sent in the current cycle, every
   * unused one equally likely, marked as sent in the same step. `guildId` is
   * the server's internal key. A server whose list is empty gets a built-in
   * wish at random, so nobody's birthday goes ungreeted.
   */
  pickFor(guildId: string): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureSeeded(tx, guildId);
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const picked = await tx.$queryRaw<Array<{ text: string }>>`
          UPDATE "BirthdayWish" SET used = true
          WHERE id = (
            SELECT id FROM "BirthdayWish"
            WHERE "guildId" = ${guildId}::uuid AND NOT used
            ORDER BY random()
            LIMIT 1
          )
          RETURNING text
        `;
        const text = picked[0]?.text;
        if (text !== undefined) return text;

        const total = await tx.birthdayWish.count({ where: { guildId } });
        if (total === 0) return builtInWish();
        // Every wish is sent (edits and removals wait on the same lock, so none is
        // hidden mid-change): start the next cycle and pick again.
        await tx.birthdayWish.updateMany({ where: { guildId }, data: { used: false } });
      }
      throw new Error('No birthday wish could be picked');
    });
  }

  /** Takes the wish lock of a server the bot knows; a server it never saw has no wishes. */
  private async lockKnownGuild(tx: Tx, discordId: string): Promise<void> {
    const guild = await tx.guild.findUnique({ where: { discordId }, select: { id: true } });
    if (guild === null) throw new ServiceError(ErrorCode.BIRTHDAY_WISH_NOT_FOUND);
    await lockWishes(tx, guild.id);
  }

  /**
   * Fills a server's list with the built-in wishes the first time it is
   * needed, without repeating a text the built-ins carry twice. The cycle the
   * server was in carries over: a built-in wish it already sent (the legacy
   * BirthdayWishUsage rows) starts out used.
   */
  private async ensureSeeded(tx: Tx, guildId: string): Promise<void> {
    if ((await lockWishes(tx, guildId)).seeded) return;

    const sent = new Set(
      (
        await tx.birthdayWishUsage.findMany({ where: { guildId }, select: { wishIndex: true } })
      ).map((row) => row.wishIndex),
    );
    const used = new Map<string, boolean>();
    BIRTHDAY_WISHES.forEach((wish, index) => {
      const text = wish.trim();
      used.set(text, (used.get(text) ?? false) || sent.has(index));
    });
    const allUsed = [...used.values()].every(Boolean);
    // One row at a time keeps the built-in order in the ids (uuidv7), which the list is sorted by.
    for (const [text, wasUsed] of used) {
      await tx.birthdayWish.create({ data: { guildId, text, used: wasUsed && !allUsed } });
    }
    await tx.guildConfig.update({ where: { guildId }, data: { birthdayWishesSeeded: true } });
  }
}
