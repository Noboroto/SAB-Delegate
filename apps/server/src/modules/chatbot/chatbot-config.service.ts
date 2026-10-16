import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  AUDIT_ACTIONS,
  CHATBOT_DEFAULT_MONTHLY_LIMIT,
  CHATBOT_MAX_CHANNELS,
  ChatbotConfigPatchSchema,
  ChatbotConfigSchema,
  ChatbotLlmOverrideInputSchema,
  ErrorCode,
  SnowflakeSchema,
  type ActorContext,
  type ChatbotConfig,
  type LlmTestResult,
} from '@sab/shared';
import { LRUCache } from 'lru-cache';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { LlmChatError, LlmChatService } from '../llm/llm-chat.service.js';
import { LlmService, type LlmTarget } from '../llm/llm.service.js';
import { ChatbotPauseService, pauseKeyOf } from '../llm/chatbot-pause.service.js';

/** One server's chatbot as far as routing a message needs. */
type Route = { enabled: boolean; channels: ReadonlySet<string> };

/**
 * Every message the bot sees asks for the route; a changed channel reaches this
 * process at once (`forget`), and the TTL bounds how long another process may
 * still serve the old one.
 */
const ROUTE_CACHE_MAX = 1_000;
const ROUTE_TTL_MS = 60_000;

const LLM_COLUMNS = {
  llmBaseUrl: true,
  llmModel: true,
  llmApiKeyEnc: true,
  llmKeyLast4: true,
} satisfies Prisma.ChatbotConfigSelect;

const NO_OVERRIDE = {
  llmBaseUrl: null,
  llmModel: null,
  llmApiKeyEnc: null,
  llmKeyLast4: null,
} satisfies Prisma.ChatbotConfigUpdateInput;

type ConfigDb = Pick<Prisma.TransactionClient, 'chatbotConfig'>;

function parseGuildId(guildId: string): string {
  const parsed = SnowflakeSchema.safeParse(guildId);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

/**
 * Where the chatbot answers, how much each member may spend by default, and the
 * model behind it: the server's own endpoint when it set one, else the shared
 * one. The slash commands, the REST API and the MCP tools all go through here.
 *
 * Only a chatbot write changes a route, so the cache is cleared by those alone.
 * A game or the word chain taking a channel changes who may claim it, never
 * which channels the chatbot has.
 */
@Injectable()
export class ChatbotConfigService {
  private readonly logger = new Logger(ChatbotConfigService.name);
  private readonly routes = new LRUCache<string, Route>({
    max: ROUTE_CACHE_MAX,
    ttl: ROUTE_TTL_MS,
    // lru-cache binds the global clock once, at import; reading it per call
    // lets a replaced clock (fake timers) take effect.
    perf: { now: () => performance.now() },
  });
  /** Servers already warned about an unreadable own key. */
  private readonly unreadableWarned = new Set<string>();
  /** Raised on every invalidation; a read that began before it must not be cached. */
  private epoch = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guilds: GuildConfigService,
    private readonly channelAccess: ChannelAccessService,
    private readonly llm: LlmService,
    private readonly chat: LlmChatService,
    private readonly pause: ChatbotPauseService,
  ) {}

  /** The server whose `#bot-log` hears about the bot's own problems. */
  get alertGuildId(): string {
    return this.llm.adminGuildId;
  }

  /**
   * Whether the chatbot is on in `channelId`: `null` for any channel that is
   * not designated. Only for deciding whether a message can be a question.
   */
  async routeOf(guildId: string, channelId: string): Promise<{ enabled: boolean } | null> {
    const id = parseGuildId(guildId);
    let route = this.routes.get(id);
    if (route === undefined) {
      const epoch = this.epoch;
      const row = await this.prisma.guild.findUnique({
        where: { discordId: id },
        select: {
          chatbot: { select: { enabled: true } },
          chatbotChannels: { select: { channelId: true } },
        },
      });
      route = {
        enabled: row?.chatbot?.enabled ?? false,
        channels: new Set(row?.chatbotChannels.map((channel) => channel.channelId)),
      };
      // A write that committed while the read was in flight may have left this
      // answer stale; serve it once, but do not keep it.
      if (epoch === this.epoch) this.routes.set(id, route);
    }
    return route.channels.has(channelId) ? { enabled: route.enabled } : null;
  }

  /** The server's chatbot, defaults for one that never configured it; writes nothing. */
  async get(guildId: string): Promise<ChatbotConfig> {
    const id = parseGuildId(guildId);
    const row = await this.prisma.guild.findUnique({
      where: { discordId: id },
      select: {
        chatbot: {
          select: { enabled: true, defaultMonthlyLimit: true, ...LLM_COLUMNS },
        },
        chatbotChannels: {
          select: { channelId: true },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const config = row?.chatbot;
    const globalTarget = await this.llm.globalTarget();
    const globalAvailable = globalTarget !== null;
    const own = config?.llmBaseUrl != null;
    let source: 'guild' | 'global' | 'none' = globalAvailable ? 'global' : 'none';
    if (own) source = 'guild';
    const pausedUntil = this.pausedUntilOf(id, source, config, globalTarget);
    return ChatbotConfigSchema.parse({
      enabled: config?.enabled ?? false,
      defaultMonthlyLimit: config?.defaultMonthlyLimit ?? CHATBOT_DEFAULT_MONTHLY_LIMIT,
      channels: row?.chatbotChannels.map((channel) => channel.channelId) ?? [],
      llm: {
        source,
        baseUrl: config?.llmBaseUrl ?? null,
        model: config?.llmModel ?? null,
        // A key the current secret cannot read is no key: the form asks again.
        keyLast4:
          config?.llmApiKeyEnc != null && this.llm.openKey(config.llmApiKeyEnc) !== null
            ? (config.llmKeyLast4 ?? null)
            : null,
        globalAvailable,
        ...(pausedUntil === null ? {} : { pausedUntil: pausedUntil.toISOString() }),
      },
    });
  }

  /** When calls to the model that answers for the server resume, `null` if they are not held back. */
  private pausedUntilOf(
    guildId: string,
    source: 'guild' | 'global' | 'none',
    own:
      | { llmBaseUrl: string | null; llmModel: string | null; llmApiKeyEnc: string | null }
      | null
      | undefined,
    globalTarget: LlmTarget | null,
  ): Date | null {
    if (source === 'global' && globalTarget !== null) {
      const { baseUrl, model, apiKey } = globalTarget;
      return this.pause.pausedUntil(pauseKeyOf(null, baseUrl, model, apiKey.slice(-4)));
    }
    if (
      source === 'guild' &&
      own?.llmBaseUrl != null &&
      own.llmModel != null &&
      own.llmApiKeyEnc != null
    ) {
      // The runtime keys the pause by the opened key's tail, not by the stored
      // column, so the dashboard asks the same way; an unreadable key answers nothing.
      const apiKey = this.llm.openKey(own.llmApiKeyEnc);
      if (apiKey === null) return null;
      return this.pause.pausedUntil(
        pauseKeyOf(guildId, own.llmBaseUrl, own.llmModel, apiKey.slice(-4)),
      );
    }
    return null;
  }

  /** Turns the chatbot on or off and/or sets the default monthly limit; the rest is left alone. */
  async configure(guildId: string, patch: unknown, actor: ActorContext): Promise<ChatbotConfig> {
    const id = parseGuildId(guildId);
    const parsed = ChatbotConfigPatchSchema.safeParse(patch);
    // A patch that names nothing would bump `updatedAt` and audit a non-change.
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const changes = {
      ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
      ...(parsed.data.defaultMonthlyLimit === undefined
        ? {}
        : { defaultMonthlyLimit: parsed.data.defaultMonthlyLimit }),
    };
    if (Object.keys(changes).length === 0) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    try {
      await this.prisma.$transaction(async (tx) => {
        const guild = await this.guilds.ensureGuild(id, undefined, tx);
        const before = await this.ensureConfig(tx, guild.id);
        const after = await tx.chatbotConfig.update({
          where: { guildId: guild.id },
          data: changes,
          select: { enabled: true, defaultMonthlyLimit: true },
        });
        const only = (settings: { enabled: boolean; defaultMonthlyLimit: number }) => ({
          ...(changes.enabled === undefined ? {} : { enabled: settings.enabled }),
          ...(changes.defaultMonthlyLimit === undefined
            ? {}
            : { defaultLimit: settings.defaultMonthlyLimit }),
        });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.chatbotConfigure,
            params: { before: only(before), after: only(after) },
          },
          tx,
        );
      });
    } finally {
      this.forget(id);
    }
    return this.get(id);
  }

  /**
   * Designates `channelId`. Discord is asked before the transaction opens: a
   * network call must not hold a database transaction. Designating a channel
   * the server already has is a no-op.
   */
  async addChannel(guildId: string, channelId: string, actor: ActorContext): Promise<void> {
    const id = parseGuildId(guildId);
    const channel = SnowflakeSchema.safeParse(channelId);
    if (!channel.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);

    // Scoped to the server: a channel of another one would hold the id here and
    // lock that server out of it.
    for (const need of ['send', 'read'] as const) {
      const access = await this.channelAccess.check(channel.data, need, id);
      if (access === 'not-found') throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
      if (access !== 'ok') {
        throw new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: need });
      }
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        const guild = await this.guilds.ensureGuild(id, undefined, tx);
        // The claim lock first: a game or the word chain taking the same
        // channel at the same moment waits for this commit and then sees it.
        await this.guilds.lockChannelClaim(channel.data, tx);
        const holder = await tx.chatbotChannel.findUnique({
          where: { channelId: channel.data },
          select: { guildId: true },
        });
        if (holder !== null) {
          if (holder.guildId === guild.id) return;
          throw new ServiceError(ErrorCode.CHANNEL_IN_USE);
        }
        const word = await tx.guildConfig.findFirst({
          where: { wordChannelId: channel.data },
          select: { id: true },
        });
        const game = await tx.gameChannel.findUnique({
          where: { channelId: channel.data },
          select: { id: true },
        });
        if (word !== null || game !== null) throw new ServiceError(ErrorCode.CHANNEL_IN_USE);

        // Two channels added together would both count the same total.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`chatbot-channels:${guild.id}`}, 0))`;
        const count = await tx.chatbotChannel.count({ where: { guildId: guild.id } });
        if (count >= CHATBOT_MAX_CHANNELS) {
          throw new ServiceError(ErrorCode.CHATBOT_CHANNEL_LIMIT_REACHED);
        }
        await tx.chatbotChannel.create({ data: { guildId: guild.id, channelId: channel.data } });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.chatbotChannelAdd,
            params: { channelId: channel.data },
          },
          tx,
        );
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Lost the race for the channel: it is this server's own (a repeated
      // request) or another one's.
      const holder = await this.prisma.chatbotChannel.findUnique({
        where: { channelId: channel.data },
        select: { guild: { select: { discordId: true } } },
      });
      if (holder === null) throw error;
      if (holder.guild.discordId !== id) throw new ServiceError(ErrorCode.CHANNEL_IN_USE);
    } finally {
      this.forget(id);
    }
  }

  /** Undesignates `channelId` and forgets what the bot remembered about it. */
  async removeChannel(guildId: string, channelId: string, actor: ActorContext): Promise<void> {
    const id = parseGuildId(guildId);
    const channel = SnowflakeSchema.safeParse(channelId);
    if (!channel.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    try {
      await this.prisma.$transaction(async (tx) => {
        const guild = await tx.guild.findUnique({ where: { discordId: id }, select: { id: true } });
        if (guild === null) return;
        const { count } = await tx.chatbotChannel.deleteMany({
          where: { guildId: guild.id, channelId: channel.data },
        });
        if (count === 0) return;
        // No foreign key ties the memory to the channel row; it goes with it.
        await tx.chatbotChannelMemory.deleteMany({
          where: { guildId: guild.id, channelId: channel.data },
        });
        await this.audit.record(
          {
            guildId: id,
            actor,
            action: AUDIT_ACTIONS.chatbotChannelRemove,
            params: { channelId: channel.data },
          },
          tx,
        );
      });
    } finally {
      this.forget(id);
    }
  }

  /**
   * Gives the server its own model. The key may be left out only while the
   * address stays the same and the stored key can still be read: a stored key
   * never goes to a new host.
   */
  async saveOverride(guildId: string, input: unknown, actor: ActorContext): Promise<ChatbotConfig> {
    const id = parseGuildId(guildId);
    const parsed = ChatbotLlmOverrideInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { baseUrl, model, apiKey } = parsed.data;
    // Sealed before the transaction: it throws when the server has no secret.
    // Fails with LLM_NOT_AVAILABLE before anything else when the server has no secret.
    this.llm.assertSecretAvailable();
    const sealed =
      apiKey === undefined
        ? null
        : { llmApiKeyEnc: this.llm.sealKey(apiKey), llmKeyLast4: apiKey.slice(-4) };

    await this.prisma.$transaction(async (tx) => {
      const guild = await this.guilds.ensureGuild(id, undefined, tx);
      await this.ensureConfig(tx, guild.id);
      const current = await tx.chatbotConfig.findUniqueOrThrow({
        where: { guildId: guild.id },
        select: LLM_COLUMNS,
      });
      if (sealed !== null) {
        await tx.chatbotConfig.update({
          where: { guildId: guild.id },
          data: { llmBaseUrl: baseUrl, llmModel: model, ...sealed },
        });
      } else {
        if (
          current.llmBaseUrl !== baseUrl ||
          current.llmApiKeyEnc === null ||
          this.llm.openKey(current.llmApiKeyEnc) === null
        ) {
          throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
        }
        // The condition is re-checked against the row as it is when the write
        // gets its lock: a clear that committed since the read above leaves
        // nothing to match, so the old key is not written back.
        const { count } = await tx.chatbotConfig.updateMany({
          where: {
            guildId: guild.id,
            llmBaseUrl: baseUrl,
            llmApiKeyEnc: current.llmApiKeyEnc,
          },
          data: { llmModel: model },
        });
        if (count === 0) throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
      }
      await this.audit.record(
        {
          guildId: id,
          actor,
          action: AUDIT_ACTIONS.chatbotLlmSet,
          params: { host: new URL(baseUrl).host, model, keyChanged: apiKey !== undefined },
        },
        tx,
      );
    });
    this.unreadableWarned.delete(id);
    // New settings deserve a new try, whatever the old ones did.
    this.pause.clearGuild(id);
    return this.get(id);
  }

  /** Back to the shared model. Nothing to clear is not an error and writes no audit row. */
  async clearOverride(guildId: string, actor: ActorContext): Promise<ChatbotConfig> {
    const id = parseGuildId(guildId);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.chatbotConfig.updateMany({
        where: { guild: { discordId: id }, llmBaseUrl: { not: null } },
        data: NO_OVERRIDE,
      });
      if (count === 0) return;
      await this.audit.record(
        { guildId: id, actor, action: AUDIT_ACTIONS.chatbotLlmClear, params: { source: 'guild' } },
        tx,
      );
    });
    this.unreadableWarned.delete(id);
    this.pause.clearGuild(id);
    return this.get(id);
  }

  /**
   * One short completion with the given settings, saved or not. Without a key
   * the stored one is used, and only for the address it was saved with.
   */
  async testOverride(guildId: string, input: unknown): Promise<LlmTestResult> {
    const id = parseGuildId(guildId);
    const parsed = ChatbotLlmOverrideInputSchema.safeParse(input);
    if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { baseUrl, model } = parsed.data;
    let apiKey = parsed.data.apiKey;
    if (apiKey === undefined) {
      this.llm.assertSecretAvailable();
      const current = await this.prisma.chatbotConfig.findFirst({
        where: { guild: { discordId: id } },
        select: LLM_COLUMNS,
      });
      if (current?.llmBaseUrl !== baseUrl || current.llmApiKeyEnc === null) {
        throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
      }
      apiKey = this.llm.openKey(current.llmApiKeyEnc) ?? undefined;
      if (apiKey === undefined) throw new ServiceError(ErrorCode.LLM_KEY_REQUIRED);
    }
    try {
      await this.chat.ping({ baseUrl, model, apiKey });
      // A working endpoint ends an outage the admin has just fixed (a top-up, a new plan).
      this.pause.clear(pauseKeyOf(id, baseUrl, model, apiKey.slice(-4)));
      return { ok: true };
    } catch (error) {
      if (error instanceof LlmChatError) return { ok: false, reason: error.reason };
      throw error;
    }
  }

  /**
   * The model that answers for the server: its own when it set one, else the
   * shared one. `null` when nothing can answer. A server whose own key cannot
   * be read gets `null`, not the shared model: it chose its own endpoint and
   * must not silently spend the shared key.
   */
  async resolveTarget(
    guildId: string,
  ): Promise<{ target: LlmTarget; source: 'guild' | 'global' } | null> {
    const id = parseGuildId(guildId);
    const own = await this.prisma.chatbotConfig.findFirst({
      where: { guild: { discordId: id } },
      select: LLM_COLUMNS,
    });
    if (own?.llmBaseUrl != null && own.llmModel !== null && own.llmApiKeyEnc !== null) {
      const apiKey = this.llm.openKey(own.llmApiKeyEnc);
      if (apiKey === null) {
        // Every message of the server asks; once is enough until the key is saved again.
        if (!this.unreadableWarned.has(id)) {
          this.unreadableWarned.add(id);
          this.logger.warn(
            `The chatbot LLM key of server ${id} cannot be read with LLM_KEY_SECRET; it has to enter it again`,
          );
        }
        return null;
      }
      return { target: { baseUrl: own.llmBaseUrl, model: own.llmModel, apiKey }, source: 'guild' };
    }
    const target = await this.llm.globalTarget();
    return target === null ? null : { target, source: 'global' };
  }

  /** Call after a write to the chatbot channels or switch of a server has committed. */
  forget(guildId: string): void {
    this.epoch += 1;
    this.routes.delete(guildId);
  }

  /**
   * The server's config row, created with the column defaults when missing.
   * `createMany` + `skipDuplicates` is `ON CONFLICT DO NOTHING`, so a caller
   * that loses the race carries on instead of failing on the unique key.
   */
  private async ensureConfig(tx: ConfigDb, guildKey: string) {
    await tx.chatbotConfig.createMany({ data: [{ guildId: guildKey }], skipDuplicates: true });
    return tx.chatbotConfig.findUniqueOrThrow({
      where: { guildId: guildKey },
      select: { enabled: true, defaultMonthlyLimit: true },
    });
  }
}
