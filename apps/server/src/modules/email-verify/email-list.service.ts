import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  EMAIL_LISTS_MAX,
  EMAIL_LIST_ENTRIES_MAX,
  EmailListCreateSchema,
  EmailListEntriesInputSchema,
  ErrorCode,
  normalizeEmail,
  z,
  type ActorContext,
  type EmailListEntriesResult,
  type EmailListSummary,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { EmailCryptoService } from './email-crypto.js';
import { isUniqueViolation, parseGuildId } from './email-verify-data.js';

type WriteOptions = { dryRun?: boolean };

/** A list as the destructive calls report it, so a preview can say what would go. */
type EmailListLoss = { listName: string; entries: number };

/** The size of one `IN (...)` lookup: well under the driver's parameter limit. */
const HASH_CHUNK = 2_000;

const LIST_SELECT = {
  id: true,
  name: true,
  createdAt: true,
  _count: { select: { entries: true } },
} satisfies Prisma.EmailListSelect;

/**
 * Named lists of addresses an access rule can refer to. An address is only
 * ever kept as a keyed hash, so a list can say whether an address is on it but
 * cannot be read back. The slash commands, the REST API and the MCP tools go
 * through here.
 */
@Injectable()
export class EmailListService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly crypto: EmailCryptoService,
  ) {}

  async list(guildId: string): Promise<EmailListSummary[]> {
    const id = parseGuildId(guildId);
    const rows = await this.prisma.emailList.findMany({
      where: { guild: { discordId: id } },
      orderBy: { name: 'asc' },
      select: LIST_SELECT,
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      entryCount: row._count.entries,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** The id of the list of that name, `EMAIL_LIST_NOT_FOUND` when the server has none. */
  async idOfName(guildId: string, name: string): Promise<string> {
    const id = parseGuildId(guildId);
    const row = await this.prisma.emailList.findFirst({
      where: { name: name.trim().toLowerCase(), guild: { discordId: id } },
      select: { id: true },
    });
    if (row === null) throw new ServiceError(ErrorCode.EMAIL_LIST_NOT_FOUND);
    return row.id;
  }

  async create(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailListSummary> {
    const id = parseGuildId(guildId);
    const parsed = EmailListCreateSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { name } = parsed.data;
    if (options.dryRun === true) {
      return {
        id: '00000000-0000-7000-8000-000000000000',
        name,
        entryCount: 0,
        createdAt: new Date().toISOString(),
      };
    }
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const guild = await this.guilds.ensureGuild(id, undefined, tx);
        // Two lists created together would both count the same total.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-lists:${guild.id}`}, 0))`;
        if ((await tx.emailList.count({ where: { guildId: guild.id } })) >= EMAIL_LISTS_MAX) {
          throw new ServiceError(ErrorCode.VALIDATION_FAILED);
        }
        const created = await tx.emailList.create({
          data: { guildId: guild.id, name },
          select: LIST_SELECT,
        });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.emailListCreate,
            params: { listName: name },
          },
          tx,
        );
        return created;
      });
      return {
        id: row.id,
        name: row.name,
        entryCount: 0,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ServiceError(ErrorCode.EMAIL_LIST_EXISTS);
      throw error;
    }
  }

  /**
   * Deletes a list with its addresses. A rule that names it stays and simply
   * no longer matches (the rules view reports it as missing). `dryRun` only
   * says what would go.
   */
  async delete(
    guildId: string,
    listId: string,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailListLoss> {
    const id = parseGuildId(guildId);
    const found = await this.find(id, listId);
    const loss = { listName: found.name, entries: found._count.entries };
    if (options.dryRun === true) return loss;
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.emailList.deleteMany({ where: { id: found.id } });
      if (count === 0) throw new ServiceError(ErrorCode.EMAIL_LIST_NOT_FOUND);
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.emailListDelete,
          params: { listName: found.name, count: loss.entries },
        },
        tx,
      );
    });
    return loss;
  }

  /**
   * Adds addresses. Text that is not an address is counted as `invalid`, an
   * address already on the list (or repeated in the batch) as `skipped`.
   */
  async addEntries(
    guildId: string,
    listId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailListEntriesResult> {
    const id = parseGuildId(guildId);
    const hashes = this.hashesOf(input);
    const found = await this.find(id, listId);
    const run = async (db: Pick<Prisma.TransactionClient, 'emailListEntry'>, write: boolean) => {
      const present = new Set<string>();
      for (const chunk of chunksOf(hashes.unique, HASH_CHUNK)) {
        const rows = await db.emailListEntry.findMany({
          where: { listId: found.id, emailHash: { in: chunk } },
          select: { emailHash: true },
        });
        for (const row of rows) present.add(row.emailHash);
      }
      const fresh = hashes.unique.filter((hash) => !present.has(hash));
      if (fresh.length > 0) {
        const existing = await db.emailListEntry.count({ where: { listId: found.id } });
        if (existing + fresh.length > EMAIL_LIST_ENTRIES_MAX) {
          throw new ServiceError(ErrorCode.EMAIL_LIST_FULL);
        }
      }
      if (write && fresh.length > 0) {
        await db.emailListEntry.createMany({
          data: fresh.map((emailHash) => ({ listId: found.id, emailHash })),
          skipDuplicates: true,
        });
      }
      return fresh.length;
    };
    if (options.dryRun === true) {
      const changed = await run(this.prisma, false);
      return { changed, skipped: hashes.valid - changed, invalid: hashes.invalid };
    }
    const changed = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`email-list:${found.id}`}, 0))`;
        const count = await run(tx, true);
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.emailListEntriesAdd,
            params: { listName: found.name, count },
          },
          tx,
        );
        return count;
      },
      { timeout: 30_000 },
    );
    return { changed, skipped: hashes.valid - changed, invalid: hashes.invalid };
  }

  /** Removes addresses; one that was not on the list is counted as `skipped`. */
  async removeEntries(
    guildId: string,
    listId: string,
    input: unknown,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailListEntriesResult> {
    const id = parseGuildId(guildId);
    const hashes = this.hashesOf(input);
    const found = await this.find(id, listId);
    let changed = 0;
    if (options.dryRun === true) {
      for (const chunk of chunksOf(hashes.unique, HASH_CHUNK)) {
        changed += await this.prisma.emailListEntry.count({
          where: { listId: found.id, emailHash: { in: chunk } },
        });
      }
    } else {
      changed = await this.prisma.$transaction(
        async (tx) => {
          let removed = 0;
          for (const chunk of chunksOf(hashes.unique, HASH_CHUNK)) {
            const { count } = await tx.emailListEntry.deleteMany({
              where: { listId: found.id, emailHash: { in: chunk } },
            });
            removed += count;
          }
          await this.audit.record(
            {
              guildId: id,
              actor,
              action: AUDIT_ACTIONS.emailListEntriesRemove,
              params: { listName: found.name, count: removed },
            },
            tx,
          );
          return removed;
        },
        { timeout: 30_000 },
      );
    }
    return { changed, skipped: hashes.valid - changed, invalid: hashes.invalid };
  }

  /** Removes every address from the list and keeps the list. `dryRun` only counts. */
  async clearEntries(
    guildId: string,
    listId: string,
    actor: ActorContext,
    options: WriteOptions = {},
  ): Promise<EmailListLoss> {
    const id = parseGuildId(guildId);
    const found = await this.find(id, listId);
    if (options.dryRun === true) return { listName: found.name, entries: found._count.entries };
    const removed = await this.prisma.$transaction(
      async (tx) => {
        const { count } = await tx.emailListEntry.deleteMany({ where: { listId: found.id } });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.emailListClear,
            params: { listName: found.name, count },
          },
          tx,
        );
        return count;
      },
      { timeout: 30_000 },
    );
    return { listName: found.name, entries: removed };
  }

  /** The list, scoped to the server: another server's list id is as good as a missing one. */
  private async find(guildId: string, listId: string) {
    const parsed = z.uuid().safeParse(listId);
    if (!parsed.success) throw new ServiceError(ErrorCode.EMAIL_LIST_NOT_FOUND);
    const row = await this.prisma.emailList.findFirst({
      where: { id: parsed.data, guild: { discordId: guildId } },
      select: LIST_SELECT,
    });
    if (row === null) throw new ServiceError(ErrorCode.EMAIL_LIST_NOT_FOUND);
    return row;
  }

  /**
   * The distinct hashes of the valid addresses of a batch, how many valid
   * addresses it held (repeats included) and how many entries were not
   * addresses at all.
   */
  private hashesOf(input: unknown): { unique: string[]; valid: number; invalid: number } {
    const parsed = EmailListEntriesInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const unique = new Set<string>();
    let valid = 0;
    let invalid = 0;
    for (const raw of parsed.data.emails) {
      const email = normalizeEmail(raw);
      if (email === null) {
        invalid += 1;
        continue;
      }
      valid += 1;
      unique.add(this.crypto.hashEmail(email));
    }
    return { unique: [...unique], valid, invalid };
  }
}

function* chunksOf<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) yield items.slice(start, start + size);
}
