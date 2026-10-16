import {
  CHATBOT_LIMIT_MAX,
  ChatbotQuotaListQuerySchema,
  ErrorCode,
  formatTokenCount,
  type ActorContext,
  type Locale,
} from '@sab/shared';
import {
  ChannelType,
  MessageFlags,
  type ApplicationCommandOptionAllowedChannelType,
} from 'discord.js';
import {
  BooleanOption,
  ChannelOption,
  Context,
  IntegerOption,
  StringOption,
  Subcommand,
  UserOption,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { Options } from '../../discord/decorators/options.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';

export type Translator = ReturnType<typeof translatorFor>;

type Interaction = SlashCommandContext[0];

/** The top-10 page of `/chatbot usage`: the biggest spenders of the month. */
const TOP_USAGE_QUERY = ChatbotQuotaListQuerySchema.parse({
  sort: 'used',
  order: 'desc',
  page: 1,
  pageSize: 10,
});

const CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

const statusText = localizations('chatbot.commands.status.description');
const enableText = localizations('chatbot.commands.enable.description');
const disableText = localizations('chatbot.commands.disable.description');
const channelAddText = localizations('chatbot.commands.channelAdd.description');
const channelRemoveText = localizations('chatbot.commands.channelRemove.description');
const limitText = localizations('chatbot.commands.limit.description');
const quotaSetText = localizations('chatbot.commands.quotaSet.description');
const quotaGrantText = localizations('chatbot.commands.quotaGrant.description');
const quotaResetText = localizations('chatbot.commands.quotaReset.description');
const usageText = localizations('chatbot.commands.usage.description');
const memoryClearText = localizations('chatbot.commands.memoryClear.description');

const channelOptionText = localizations('chatbot.commands.channelOption.description');
const userOptionText = localizations('chatbot.commands.userOption.description');
const amountOptionText = localizations('chatbot.commands.amountOption.description');
const limitOptionText = localizations('chatbot.commands.limitOption.description');
const clearOptionText = localizations('chatbot.commands.clearOption.description');
const tokensOptionText = localizations('chatbot.commands.tokensOption.description');
const scopeOptionText = localizations('chatbot.commands.scopeOption.description');
const usageUserOptionText = localizations('chatbot.commands.usageUserOption.description');
const clearUserOptionText = localizations('chatbot.commands.clearUserOption.description');
const clearChannelOptionText = localizations('chatbot.commands.clearChannelOption.description');

const SCOPE_CHOICES = [
  { value: 'user', names: localizations('chatbot.commands.scopeUser.description') },
  { value: 'channel', names: localizations('chatbot.commands.scopeChannel.description') },
  { value: 'all', names: localizations('chatbot.commands.scopeAll.description') },
].map(({ value, names }) => ({ name: names['en-US'], name_localizations: names, value }));

/** The commands are offered in direct messages too (see AGENTS.md); there is no chatbot there. */
function guildOf(interaction: Interaction): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

export function actorOf(interaction: Interaction): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/**
 * Acknowledges privately and resolves the server's language. The lookups behind
 * every chatbot answer can outlast the 3 s window for a first reply.
 */
export async function openReply(
  interaction: Interaction,
  locales: GuildLocaleService,
): Promise<{ guildId: string; locale: Locale; t: Translator }> {
  const guildId = guildOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const locale = await locales.resolve(guildId, interaction);
  return { guildId, locale, t: translatorFor(locale) };
}

/** Private, split to Discord's length, and pinging nobody whatever a member's text contains. */
export function answer(interaction: Interaction, content: string | readonly string[]) {
  return replyInChunks(interaction, content, {
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

/** `<@user>: used x, remaining y / total`, the remaining part worded like the reply footer. */
function standingLine(
  t: Translator,
  locale: Locale,
  user: string,
  figures: { used: number; remaining: number; total: number },
): string {
  return t('chatbot.slash.standing', {
    user: `<@${user}>`,
    used: formatTokenCount(figures.used, locale),
    remaining: formatTokenCount(figures.remaining, locale),
    total: formatTokenCount(figures.total, locale),
  });
}

class ChannelArg {
  @ChannelOption({
    name: 'channel',
    description: channelOptionText['en-US'],
    description_localizations: channelOptionText,
    channel_types: CHANNEL_TYPES,
    required: true,
  })
  readonly channel!: { readonly id: string };
}

class LimitArg {
  @IntegerOption({
    name: 'amount',
    description: amountOptionText['en-US'],
    description_localizations: amountOptionText,
    min_value: 0,
    max_value: CHATBOT_LIMIT_MAX,
    required: true,
  })
  readonly amount!: number;
}

class MemberArg {
  @UserOption({
    name: 'user',
    description: userOptionText['en-US'],
    description_localizations: userOptionText,
    required: true,
  })
  readonly user!: { readonly id: string };
}

// Each class declares `user` itself, first: Necord collects option metadata
// child class first, so an inherited required option would follow the optional
// ones, and Discord rejects the whole command set (50035) when a required
// option comes after an optional one.
class QuotaSetArgs {
  @UserOption({
    name: 'user',
    description: userOptionText['en-US'],
    description_localizations: userOptionText,
    required: true,
  })
  readonly user!: { readonly id: string };

  @IntegerOption({
    name: 'limit',
    description: limitOptionText['en-US'],
    description_localizations: limitOptionText,
    min_value: 0,
    max_value: CHATBOT_LIMIT_MAX,
    required: false,
  })
  readonly limit?: number;

  @BooleanOption({
    name: 'clear',
    description: clearOptionText['en-US'],
    description_localizations: clearOptionText,
    required: false,
  })
  readonly clear?: boolean;
}

class QuotaGrantArgs {
  @UserOption({
    name: 'user',
    description: userOptionText['en-US'],
    description_localizations: userOptionText,
    required: true,
  })
  readonly user!: { readonly id: string };

  @IntegerOption({
    name: 'tokens',
    description: tokensOptionText['en-US'],
    description_localizations: tokensOptionText,
    min_value: -CHATBOT_LIMIT_MAX,
    max_value: CHATBOT_LIMIT_MAX,
    required: true,
  })
  readonly tokens!: number;
}

class UsageArgs {
  @UserOption({
    name: 'user',
    description: usageUserOptionText['en-US'],
    description_localizations: usageUserOptionText,
    required: false,
  })
  readonly user?: { readonly id: string };
}

class MemoryClearArgs {
  @StringOption({
    name: 'scope',
    description: scopeOptionText['en-US'],
    description_localizations: scopeOptionText,
    choices: SCOPE_CHOICES,
    required: true,
  })
  readonly scope!: string;

  @UserOption({
    name: 'user',
    description: clearUserOptionText['en-US'],
    description_localizations: clearUserOptionText,
    required: false,
  })
  readonly user?: { readonly id: string };

  @ChannelOption({
    name: 'channel',
    description: clearChannelOptionText['en-US'],
    description_localizations: clearChannelOptionText,
    channel_types: CHANNEL_TYPES,
    required: false,
  })
  readonly channel?: { readonly id: string };
}

/**
 * `/chatbot ...`, the managers' side of the chatbot. Who may run them is
 * decided by the group's default permission in Discord; nothing is checked
 * here, and destructive ones apply at once. The model behind the chatbot holds
 * a key, which a slash option would leave in the channel log, so it is set on
 * the dashboard only. Answers are private.
 */
@DiscordCommands()
@CommandGroup.chatbot()
export class ChatbotCommands {
  constructor(
    private readonly config: ChatbotConfigService,
    private readonly quota: ChatbotQuotaService,
    private readonly memory: ChatbotMemoryService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'status',
    description: statusText['en-US'],
    descriptionLocalizations: statusText,
  })
  async onStatus(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    const { enabled, defaultMonthlyLimit, channels, llm } = await this.config.get(guildId);

    const model = [t(`chatbot.slash.status.source.${llm.source}`)];
    if (llm.model !== null) model.push(llm.model);
    if (llm.keyLast4 !== null) model.push(t('chatbot.slash.status.key', { last4: llm.keyLast4 }));
    const lines = [
      t('chatbot.slash.status.body', {
        state: t(enabled ? 'chatbot.slash.status.on' : 'chatbot.slash.status.off'),
        channels:
          channels.length === 0
            ? t('chatbot.slash.status.noChannels')
            : channels.map((id) => `<#${id}>`).join(', '),
        limit: formatTokenCount(defaultMonthlyLimit, locale),
        model: model.join(' · '),
      }),
    ];
    if (llm.pausedUntil !== undefined) {
      const until = `<t:${Math.floor(Date.parse(llm.pausedUntil) / 1000)}:R>`;
      lines.push(t('chatbot.slash.status.paused', { until }));
    }
    lines.push(t('chatbot.slash.status.dashboardHint'));
    await answer(interaction, lines.join('\n'));
  }

  @Subcommand({
    name: 'enable',
    description: enableText['en-US'],
    descriptionLocalizations: enableText,
  })
  async onEnable(@Context() [interaction]: SlashCommandContext): Promise<void> {
    await this.switchTo(interaction, true);
  }

  @Subcommand({
    name: 'disable',
    description: disableText['en-US'],
    descriptionLocalizations: disableText,
  })
  async onDisable(@Context() [interaction]: SlashCommandContext): Promise<void> {
    await this.switchTo(interaction, false);
  }

  @Subcommand({
    name: 'channel-add',
    description: channelAddText['en-US'],
    descriptionLocalizations: channelAddText,
  })
  async onChannelAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: ChannelArg,
  ): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    await this.config.addChannel(guildId, channel.id, actorOf(interaction));
    await answer(interaction, t('chatbot.slash.channelAdded', { channel: `<#${channel.id}>` }));
  }

  @Subcommand({
    name: 'channel-remove',
    description: channelRemoveText['en-US'],
    descriptionLocalizations: channelRemoveText,
  })
  async onChannelRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: ChannelArg,
  ): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    await this.config.removeChannel(guildId, channel.id, actorOf(interaction));
    await answer(interaction, t('chatbot.slash.channelRemoved', { channel: `<#${channel.id}>` }));
  }

  @Subcommand({
    name: 'limit',
    description: limitText['en-US'],
    descriptionLocalizations: limitText,
  })
  async onLimit(
    @Context() [interaction]: SlashCommandContext,
    @Options() { amount }: LimitArg,
  ): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    await this.config.configure(guildId, { defaultMonthlyLimit: amount }, actorOf(interaction));
    await answer(
      interaction,
      t('chatbot.slash.limitSet', { limit: formatTokenCount(amount, locale) }),
    );
  }

  /** `limit` or `clear`, exactly one: both or neither would leave the intent unclear. */
  @Subcommand({
    name: 'quota-set',
    description: quotaSetText['en-US'],
    descriptionLocalizations: quotaSetText,
  })
  async onQuotaSet(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, limit, clear }: QuotaSetArgs,
  ): Promise<void> {
    const clearing = clear === true;
    if (clearing === (limit !== undefined)) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    const quota = await this.quota.setLimit(
      guildId,
      user.id,
      clearing ? null : (limit ?? null),
      actorOf(interaction),
    );
    const head = clearing
      ? t('chatbot.slash.quotaCleared', { user: `<@${user.id}>` })
      : t('chatbot.slash.quotaSet', {
          user: `<@${user.id}>`,
          limit: formatTokenCount(quota.limit, locale),
        });
    await answer(interaction, `${head}\n${standingLine(t, locale, user.id, quota)}`);
  }

  @Subcommand({
    name: 'quota-grant',
    description: quotaGrantText['en-US'],
    descriptionLocalizations: quotaGrantText,
  })
  async onQuotaGrant(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, tokens }: QuotaGrantArgs,
  ): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    const quota = await this.quota.grant(guildId, user.id, tokens, actorOf(interaction));
    const head = t(tokens < 0 ? 'chatbot.slash.grantTaken' : 'chatbot.slash.grantAdded', {
      user: `<@${user.id}>`,
      tokens: formatTokenCount(Math.abs(tokens), locale),
    });
    await answer(interaction, `${head}\n${standingLine(t, locale, user.id, quota)}`);
  }

  @Subcommand({
    name: 'quota-reset',
    description: quotaResetText['en-US'],
    descriptionLocalizations: quotaResetText,
  })
  async onQuotaReset(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: MemberArg,
  ): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    const { used } = await this.quota.reset(guildId, user.id, actorOf(interaction), {
      dryRun: false,
    });
    await answer(
      interaction,
      t('chatbot.slash.quotaReset', {
        user: `<@${user.id}>`,
        used: formatTokenCount(used, locale),
      }),
    );
  }

  @Subcommand({
    name: 'usage',
    description: usageText['en-US'],
    descriptionLocalizations: usageText,
  })
  async onUsage(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: UsageArgs,
  ): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    if (user !== undefined) {
      const quota = await this.quota.limitOf(guildId, user.id);
      await answer(interaction, standingLine(t, locale, user.id, quota));
      return;
    }
    const { items } = await this.quota.list(guildId, TOP_USAGE_QUERY);
    if (items.length === 0) {
      await answer(interaction, t('chatbot.slash.usageTopEmpty'));
      return;
    }
    const rows = items.map(
      (row, index) =>
        `${index + 1}. ${standingLine(t, locale, row.userId, {
          used: row.used,
          remaining: row.remaining,
          total: row.limit + row.bonus,
        })}`,
    );
    await answer(interaction, [t('chatbot.slash.usageTopTitle'), ...rows].join('\n'));
  }

  /** The service refuses an id the scope does not name, so a stray option clears nothing. */
  @Subcommand({
    name: 'memory-clear',
    description: memoryClearText['en-US'],
    descriptionLocalizations: memoryClearText,
  })
  async onMemoryClear(
    @Context() [interaction]: SlashCommandContext,
    @Options() { scope, user, channel }: MemoryClearArgs,
  ): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    const result = await this.memory.clear(
      guildId,
      {
        scope,
        dryRun: false,
        ...(user === undefined ? {} : { userId: user.id }),
        ...(channel === undefined ? {} : { channelId: channel.id }),
      },
      actorOf(interaction),
    );
    await answer(
      interaction,
      t('chatbot.slash.memoryCleared', {
        users: String(result.userMemories),
        channels: String(result.channelMemories),
      }),
    );
  }

  private async switchTo(interaction: Interaction, enabled: boolean): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    await this.config.configure(guildId, { enabled }, actorOf(interaction));
    await answer(interaction, t(enabled ? 'chatbot.slash.enabled' : 'chatbot.slash.disabled'));
  }
}
