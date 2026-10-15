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
import { LRUCache } from 'lru-cache';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type Db = Pick<Prisma.TransactionClient, 'guild' | 'guildConfig'>;
type GameChannelDb = Pick<Prisma.TransactionClient, 'gameChannel'>;

/** The server's own row: `id` is the internal key other tables reference. */
type GuildRecord = {
  id: string;
  discordId: string;
  name: string | null;
  locale: string;
};

type PatchOptions = { dryRun?: boolean };

/** Where the word game of a server is played, as far as routing a message needs. */
type WordGameRoute = { channelId: string; maxWords: number };

/**
 * A message in any channel asks for the route; a changed setting reaches this
 * process at once (`forgetWordGameRoute`), and the TTL bounds how long another
 * process may still serve the old channel.
 */
const WORD_ROUTE_CACHE_MAX = 1_000;
const WORD_ROUTE_TTL_MS = 60_000;

/** The settings that hold a message channel the bot has to work in. */
const CHANNEL_SETTINGS = [
  'introChannelId',
  'logChannelId',
  'birthdayChannelId',
  'wordChannelId',
] as const;
export type ChannelSetting = (typeof CHANNEL_SETTINGS)[number];

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
  /** "Not configured" is an answer too; the wrapper lets the cache hold it. */
  private readonly wordRoutes = new LRUCache<string, { route: WordGameRoute | null }>({
    max: WORD_ROUTE_CACHE_MAX,
    ttl: WORD_ROUTE_TTL_MS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });
  /** Raised on every invalidation; a read that began before it must not be cached. */
  private wordRouteEpoch = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  /**
   * The word channel and limit of a server, `null` when it has no game channel
   * or is unknown. Only for deciding whether a message can be a move: the move
   * itself is judged on a fresh read inside the game service.
   */
  async wordGameRoute(guildId: string): Promise<WordGameRoute | null> {
    const id = parseGuildId(guildId);
    const cached = this.wordRoutes.get(id);
    if (cached !== undefined) return cached.route;

    const epoch = this.wordRouteEpoch;
    const settings = toSettings(await this.readRow(this.prisma, id));
    const route =
      settings.wordChannelId === null
        ? null
        : { channelId: settings.wordChannelId, maxWords: settings.wordMaxWords };
    // A write that committed while the read was in flight may have left this
    // answer stale; serve it once, but do not keep it.
    if (epoch === this.wordRouteEpoch) this.wordRoutes.set(id, { route });
    return route;
  }

  /** Call after a write to the word channel or limit has committed. */
  forgetWordGameRoute(guildId: string): void {
    this.wordRouteEpoch += 1;
    this.wordRoutes.delete(guildId);
  }

  /**
   * Makes sure the server has its row and a settings row, and keeps the cached
   * display name current when one is given. Safe to call any number of times,
   * concurrently, from any number of transactions. Pass `tx` to run inside the
   * caller's transaction.
   *
   * Each row is created with `createMany` + `skipDuplicates`, which is
   * `INSERT .. ON CONFLICT DO NOTHING`: a caller that loses the race waits for
   * the winner and carries on, instead of failing on the unique key (P2002) the
   * way a read-then-insert does. Prisma's `upsert` is that read-then-insert
   * whenever it cannot compile to one `ON CONFLICT` statement, so it is not
   * relied on here.
   */
  async ensureGuild(discordId: string, name?: string, tx?: Db): Promise<GuildRecord> {
    const id = parseGuildId(discordId);
    const db: Db = tx ?? this.prisma;
    await db.guild.createMany({
      data: [{ discordId: id, name: name ?? null }],
      skipDuplicates: true,
    });
    if (name !== undefined) {
      // Only when it differs: the sync runs for every server at every boot.
      await db.guild.updateMany({
        where: { discordId: id, OR: [{ name: null }, { name: { not: name } }] },
        data: { name },
      });
    }
    const guild = await db.guild.findUniqueOrThrow({
      where: { discordId: id },
      select: GUILD_SELECT,
    });
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

    await this.assertChannelsUsable(changes, id, actor);

    if (opts.dryRun === true) {
      const before = toSettings(await this.readRow(this.prisma, id));
      return { before, after: GuildSettingsSchema.parse({ ...before, ...changes }) };
    }

    const { locale, ...configChanges } = changes;
    const updated = await this.prisma.$transaction(async (tx) => {
      const guild = await this.ensureGuild(id, undefined, tx);
      const before = toSettings(await this.readRow(tx, id));

      if (configChanges.wordChannelId != null) {
        await this.assertNotGameChannel(configChanges.wordChannelId, tx);
      }
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
    this.forgetWordGameRoute(id);
    return updated;
  }

  /**
   * `CHANNEL_IN_USE` when `channelId` hosts a channel game: the word chain
   * there would judge every message a second time. Run it inside the
   * transaction that sets the word channel.
   */
  async assertNotGameChannel(channelId: string, db: GameChannelDb = this.prisma): Promise<void> {
    const holder = await db.gameChannel.findUnique({ where: { channelId }, select: { id: true } });
    if (holder !== null) throw new ServiceError(ErrorCode.CHANNEL_IN_USE);
  }

  private readRow(db: Pick<Prisma.TransactionClient, 'guild'>, discordId: string) {
    return db.guild.findUnique({ where: { discordId }, select: SETTINGS_SELECT });
  }

  /**
   * The bot reads the intro channel and posts in the others, so each is held
   * to the permission it actually needs. `DISCORD_CHANNEL_NOT_FOUND` when the
   * channel does not exist for the bot; `DISCORD_MISSING_PERMISSIONS` (naming
   * `view` or `send`) when it exists but the bot may not do its job there.
   * The category of the activity command is not a message channel and is
   * checked when the command uses it.
   *
   * A slash command calls this before it defers, so a refusal is a quick
   * private answer; `patch` repeats it for the callers that do not.
   *
   * Pass `scope` for callers other than a slash command (REST, MCP): the
   * channel must then belong to that server, and another server's channel is
   * indistinguishable from a missing one.
   */
  async assertChannelUsable(
    setting: ChannelSetting,
    channelId: string,
    scope?: { guildId: string; actor: ActorContext },
  ): Promise<void> {
    const need = setting === 'introChannelId' ? 'read' : 'send';
    const access =
      scope === undefined || scope.actor.source === 'DISCORD'
        ? await this.channelAccess.check(channelId, need)
        : await this.channelAccess.check(channelId, need, scope.guildId);
    if (access === 'ok') return;
    if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
    throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, {
      permission: need === 'read' ? 'view' : 'send',
    });
  }

  private async assertChannelsUsable(
    changes: Partial<Record<ChannelSetting, string | null>>,
    guildId: string,
    actor: ActorContext,
  ): Promise<void> {
    for (const setting of CHANNEL_SETTINGS) {
      const channelId = changes[setting];
      if (channelId === undefined || channelId === null) continue;
      await this.assertChannelUsable(setting, channelId, { guildId, actor });
    }
  }
}
