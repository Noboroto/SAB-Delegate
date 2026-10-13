import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  NoteKeySchema,
  NoteUpsertSchema,
  SnowflakeSchema,
  escapeLike,
  type ActorContext,
  type Note,
  type NoteRemovePlan,
  type NoteRemoveResult,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';

type RemoveOptions = { dryRun?: boolean };

/** Discord shows at most this many suggestions. */
const TOPICS_DEFAULT_LIMIT = 25;

const NOTE_SELECT = {
  roleId: true,
  topic: true,
  content: true,
  updatedAt: true,
} satisfies Prisma.NoteEntrySelect;

function parseSnowflake(value: string): string {
  const parsed = SnowflakeSchema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function parseKey(input: unknown): { roleId: string; topic: string } {
  const parsed = NoteKeySchema.safeParse(input);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * Notes a server keeps against its roles: one text per (role, topic), the topic
 * being case-sensitive. The slash commands, the REST API and the MCP tools all
 * go through here, so validation and the audit trail are the same for each.
 */
@Injectable()
export class NoteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
  ) {}

  /**
   * Saves a note; a note with the same role and topic is replaced. The write
   * and its audit row commit together. The audit row names the role and topic
   * but never the text.
   */
  async upsert(guildId: string, input: unknown, actor: ActorContext): Promise<Note> {
    const id = parseSnowflake(guildId);
    const parsed = NoteUpsertSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { roleId, topic, content } = parsed.data;

    return this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      // One INSERT .. ON CONFLICT on the (guild, role, topic) key: two people
      // saving the same topic at once both succeed and the later write wins.
      const note = await tx.noteEntry.upsert({
        where: { guildId_roleId_topic: { guildId: guild.id, roleId, topic } },
        create: { guildId: guild.id, roleId, topic, content },
        update: { content },
        select: NOTE_SELECT,
      });
      await this.audit.record(
        { guildId: id, actor, action: AUDIT_ACTIONS.noteUpsert, params: { roleId, topic } },
        tx,
      );
      return note;
    });
  }

  /** One note, or null when the role has none with that topic. */
  async get(guildId: string, roleId: string, topic: string): Promise<Note | null> {
    const id = parseSnowflake(guildId);
    const key = parseKey({ roleId, topic });
    return this.prisma.noteEntry.findFirst({
      where: { guild: { discordId: id }, ...key },
      select: NOTE_SELECT,
    });
  }

  /** A role's notes in the order they were first saved. */
  async listByRole(guildId: string, roleId: string): Promise<Note[]> {
    const id = parseSnowflake(guildId);
    const role = parseSnowflake(roleId);
    return this.prisma.noteEntry.findMany({
      where: { guild: { discordId: id }, roleId: role },
      select: NOTE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Every note of the server, grouped by role. */
  async listAll(guildId: string): Promise<Note[]> {
    const id = parseSnowflake(guildId);
    return this.prisma.noteEntry.findMany({
      where: { guild: { discordId: id } },
      select: NOTE_SELECT,
      orderBy: [{ roleId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Topics of one role whose text contains `search`, ignoring case, for
   * autocomplete. The search is escaped: it is typed by a person and must not
   * act as a pattern.
   */
  async listTopics(
    guildId: string,
    roleId: string,
    search = '',
    limit = TOPICS_DEFAULT_LIMIT,
  ): Promise<string[]> {
    const id = parseSnowflake(guildId);
    const role = parseSnowflake(roleId);
    const needle = search.trim();
    const rows = await this.prisma.noteEntry.findMany({
      where: {
        guild: { discordId: id },
        roleId: role,
        ...(needle === ''
          ? {}
          : { topic: { contains: escapeLike(needle), mode: 'insensitive' as const } }),
      },
      select: { topic: true },
      orderBy: [{ topic: 'asc' }],
      take: Math.max(1, Math.min(limit, TOPICS_DEFAULT_LIMIT)),
    });
    return rows.map((row) => row.topic);
  }

  /**
   * Removes the note with this role and topic. A note that is not there is not
   * an error: the result says `count: 0` and nothing is audited, as nothing
   * changed. With `dryRun` the plan is returned and nothing is written; the
   * real run deletes exactly the rows the plan named.
   */
  remove(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<NoteRemovePlan>;
  remove(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<NoteRemoveResult>;
  remove(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts?: RemoveOptions,
  ): Promise<NoteRemovePlan | NoteRemoveResult>;
  async remove(
    guildId: string,
    input: unknown,
    actor: ActorContext,
    opts: RemoveOptions = {},
  ): Promise<NoteRemovePlan | NoteRemoveResult> {
    const id = parseSnowflake(guildId);
    const key = parseKey(input);

    if (opts.dryRun === true) {
      const planned = await this.plan(this.prisma, id, key);
      return {
        count: planned.length,
        sample: planned.map(({ roleId, topic }) => ({ roleId, topic })),
      };
    }

    return this.prisma.$transaction(async (tx) => {
      const planned = await this.plan(tx, id, key);
      if (planned.length === 0) return { count: 0 };

      const { count } = await tx.noteEntry.deleteMany({
        where: { id: { in: planned.map((row) => row.id) } },
      });
      if (count > 0) {
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.noteRemove,
            params: { roleId: key.roleId, topic: key.topic, count },
          },
          tx,
        );
      }
      return { count };
    });
  }

  /** The rows a removal would delete: the single source for the preview and the real run. */
  private plan(
    db: Pick<Prisma.TransactionClient, 'noteEntry'>,
    guildDiscordId: string,
    key: { roleId: string; topic: string },
  ) {
    return db.noteEntry.findMany({
      where: { guild: { discordId: guildDiscordId }, ...key },
      select: { id: true, roleId: true, topic: true },
    });
  }
}
