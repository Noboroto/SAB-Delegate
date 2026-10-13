import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  DEFAULT_LOCALE,
  ErrorCode,
  GuildSettingsPatchSchema,
  GuildSettingsSchema,
  SnowflakeSchema,
  type ActorContext,
  type GuildSettings,
  type GuildSettingsDryRun,
} from '@sab/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type Db = Pick<Prisma.TransactionClient, 'guild' | 'guildConfig'>;

/** The server's own row: `id` is the internal key other tables reference. */
type GuildRecord = {
  id: string;
  discordId: string;
  name: string | null;
  locale: string;
};

type PatchOptions = { dryRun?: boolean };

const GUILD_SELECT = {
  id: true,
  discordId: true,
  name: true,
  locale: true,
} satisfies Prisma.GuildSelect;

const SETTINGS_SELECT = {
  locale: true,
  config: {
    select: {
      introChannelId: true,
      logChannelId: true,
      birthdayChannelId: true,
      activityCategoryId: true,
      wordChannelId: true,
      wordMaxWords: true,
    },
  },
} satisfies Prisma.GuildSelect;

type SettingsRow = Prisma.GuildGetPayload<{ select: typeof SETTINGS_SELECT }>;

function toSettings(row: SettingsRow | null): GuildSettings {
  const config = row?.config;
  // Parsed rather than cast: the schema is what the rest of the system relies
  // on, and it supplies the word-game default for a server without a config row.
  return GuildSettingsSchema.parse({
    introChannelId: config?.introChannelId ?? null,
    logChannelId: config?.logChannelId ?? null,
    birthdayChannelId: config?.birthdayChannelId ?? null,
    activityCategoryId: config?.activityCategoryId ?? null,
    wordChannelId: config?.wordChannelId ?? null,
    wordMaxWords: config?.wordMaxWords,
    locale: row?.locale ?? DEFAULT_LOCALE,
  });
}

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * Per-server settings: the channels the bot works in and the language it
 * answers in. The slash commands, the REST API and the MCP tools all go
 * through here, so validation and the audit trail are the same for each.
 */
@Injectable()
export class GuildConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * Makes sure the server has its row and a settings row, and keeps the cached
   * display name current when one is given. Safe to call any number of times,
   * concurrently: both writes are single-statement upserts on a unique key.
   * Pass `tx` to run inside the caller's transaction.
   */
  async ensureGuild(discordId: string, name?: string, tx?: Db): Promise<GuildRecord> {
    const id = parseGuildId(discordId);
    const db: Db = tx ?? this.prisma;
    const guild = await db.guild.upsert({
      where: { discordId: id },
      create: { discordId: id, name: name ?? null },
      update: name === undefined ? {} : { name },
      select: GUILD_SELECT,
    });
    // `createMany` + `skipDuplicates` is `INSERT .. ON CONFLICT DO NOTHING`:
    // two callers announcing the same server cannot collide. Prisma's `upsert`
    // here is a read then an insert, and the loser fails on the unique key.
    await db.guildConfig.createMany({ data: [{ guildId: guild.id }], skipDuplicates: true });
    return guild;
  }

  /** The server's settings; `GUILD_NOT_FOUND` when the bot has never seen it. */
  async get(guildId: string): Promise<GuildSettings> {
    const row = await this.readRow(this.prisma, parseGuildId(guildId));
    if (row === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return toSettings(row);
  }

  /**
   * Changes the given settings and leaves the rest. With `dryRun` it returns
   * the current and the planned settings and writes nothing, not even the
   * audit row; without it the change and its audit row commit together.
   *
   * Channels are checked against Discord before the transaction opens: a
   * network call must not hold a database transaction.
   */
  patch(
    guildId: string,
    patch: unknown,
    actor: ActorContext,
    opts: { dryRun: true },
  ): Promise<GuildSettingsDryRun>;
  patch(
    guildId: string,
    patch: unknown,
    actor: ActorContext,
    opts?: { dryRun?: false },
  ): Promise<GuildSettings>;
  patch(
    guildId: string,
    patch: unknown,
    actor: ActorContext,
    opts?: PatchOptions,
  ): Promise<GuildSettings | GuildSettingsDryRun>;
  async patch(
    guildId: string,
    patch: unknown,
    actor: ActorContext,
    opts: PatchOptions = {},
  ): Promise<GuildSettings | GuildSettingsDryRun> {
    const id = parseGuildId(guildId);
    const parsed = GuildSettingsPatchSchema.safeParse(patch);
    // A patch that names nothing this service knows would be a silent no-op.
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    }
    const changes = parsed.data;

    await this.assertChannelsUsable(changes);

    if (opts.dryRun === true) {
      const before = toSettings(await this.readRow(this.prisma, id));
      return { before, after: GuildSettingsSchema.parse({ ...before, ...changes }) };
    }

    const { locale, ...configChanges } = changes;
    return this.prisma.$transaction(async (tx) => {
      const guild = await this.ensureGuild(id, undefined, tx);
      const before = toSettings(await this.readRow(tx, id));

      if (Object.keys(configChanges).length > 0) {
        await tx.guildConfig.update({ where: { guildId: guild.id }, data: configChanges });
      }
      if (locale !== undefined) {
        await tx.guild.update({ where: { id: guild.id }, data: { locale } });
      }
      const after = toSettings(await this.readRow(tx, id));

      const keys = Object.keys(changes) as Array<keyof GuildSettings>;
      const only = (settings: GuildSettings) =>
        Object.fromEntries(keys.map((key) => [key, settings[key]]));
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.guildConfigUpdate,
          params: { before: only(before), after: only(after) },
        },
        tx,
      );
      return after;
    });
  }

  private readRow(db: Pick<Prisma.TransactionClient, 'guild'>, discordId: string) {
    return db.guild.findUnique({ where: { discordId }, select: SETTINGS_SELECT });
  }

  /**
   * The bot reads the intro channel and posts in the others, so each is held
   * to the permission it actually needs. The category of the activity command
   * is not a message channel and is checked when the command uses it.
   */
  private async assertChannelsUsable(changes: {
    introChannelId?: string | null;
    logChannelId?: string | null;
    birthdayChannelId?: string | null;
    wordChannelId?: string | null;
  }): Promise<void> {
    const needs: Array<[string | null | undefined, 'read' | 'send']> = [
      [changes.introChannelId, 'read'],
      [changes.logChannelId, 'send'],
      [changes.birthdayChannelId, 'send'],
      [changes.wordChannelId, 'send'],
    ];
    for (const [channelId, need] of needs) {
      if (channelId === undefined || channelId === null) continue;
      const usable =
        need === 'read'
          ? await this.channelAccess.botCanRead(channelId)
          : await this.channelAccess.botCanSend(channelId);
      if (!usable) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    }
  }
}
