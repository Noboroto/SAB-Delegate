import { ChatbotTurnListQuerySchema, formatTokenCount, type ChatbotTurnRow } from '@sab/shared';
import { Context, Subcommand, type SlashCommandContext } from 'necord';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { clipText } from './chatbot-prompt.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotMemoryService } from './chatbot-memory.service.js';
import { resetMarkup } from './chatbot-period.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import { actorOf, answer, openReply, type Translator } from './chatbot.commands.js';

const HISTORY_TURNS = 5;

/** Room for five turns in a few messages; the full text is on the dashboard for managers. */
const QUESTION_MAX_CHARS = 300;
const ANSWER_MAX_CHARS = 600;

const memoryText = localizations('chatbot.commands.memory.description');
const memoryClearText = localizations('chatbot.commands.selfMemoryClear.description');
const usageText = localizations('chatbot.commands.selfUsage.description');
const historyText = localizations('chatbot.commands.history.description');
const historyClearText = localizations('chatbot.commands.historyClear.description');

/** One line of text: a member's words cannot break the entry's layout. */
function oneLine(value: string, max: number): string {
  return clipText(value.replace(/\s+/g, ' ').trim(), max);
}

function entryOf(t: Translator, turn: ChatbotTurnRow): string {
  return t('chatbot.slash.historyEntry', {
    when: `<t:${Math.floor(Date.parse(turn.createdAt) / 1000)}:f>`,
    channel: `<#${turn.channelId}>`,
    question: oneLine(turn.question, QUESTION_MAX_CHARS),
    answer:
      turn.answer === null
        ? t(`chatbot.slash.historyStatus.${turn.status}`)
        : oneLine(turn.answer, ANSWER_MAX_CHARS),
  });
}

/**
 * `/chat memory|memory-clear|usage|history|history-clear`: a member's own view
 * of the chatbot. Every call is keyed by the caller's id and this server, so
 * what comes back is the caller's rows only: never another member's text and
 * never the context snapshot a turn was answered with. No permission is
 * checked; the group has no default permission. Answers are private.
 */
@DiscordCommands()
@CommandGroup.chat()
export class ChatbotSelfCommands {
  constructor(
    private readonly memory: ChatbotMemoryService,
    private readonly quota: ChatbotQuotaService,
    private readonly history: ChatbotHistoryService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'memory',
    description: memoryText['en-US'],
    descriptionLocalizations: memoryText,
  })
  async onMemory(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    const summary = await this.memory.getOwn(guildId, interaction.user.id);
    await answer(
      interaction,
      summary === null ? t('chatbot.slash.memoryNone') : t('chatbot.slash.memoryShow', { summary }),
    );
  }

  @Subcommand({
    name: 'memory-clear',
    description: memoryClearText['en-US'],
    descriptionLocalizations: memoryClearText,
  })
  async onMemoryClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    const { userMemories } = await this.memory.clear(
      guildId,
      { scope: 'user', userId: interaction.user.id, dryRun: false },
      actorOf(interaction),
    );
    await answer(
      interaction,
      t(userMemories === 0 ? 'chatbot.slash.selfMemoryNothing' : 'chatbot.slash.selfMemoryCleared'),
    );
  }

  @Subcommand({
    name: 'usage',
    description: usageText['en-US'],
    descriptionLocalizations: usageText,
  })
  async onUsage(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, locale, t } = await openReply(interaction, this.locales);
    const quota = await this.quota.limitOf(guildId, interaction.user.id);
    // Same figures and wording as the footer of a reply: `remaining x / total`.
    await answer(
      interaction,
      t('chatbot.slash.usageSelf', {
        used: formatTokenCount(quota.used, locale),
        remaining: formatTokenCount(quota.remaining, locale),
        total: formatTokenCount(quota.total, locale),
        reset: resetMarkup(new Date()),
      }),
    );
  }

  @Subcommand({
    name: 'history',
    description: historyText['en-US'],
    descriptionLocalizations: historyText,
  })
  async onHistory(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    const query = ChatbotTurnListQuerySchema.parse({
      userId: interaction.user.id,
      page: 1,
      pageSize: HISTORY_TURNS,
      order: 'desc',
    });
    const { items } = await this.history.list(guildId, query);
    if (items.length === 0) {
      await answer(interaction, t('chatbot.slash.historyEmpty'));
      return;
    }
    const entries = items.map((turn) => entryOf(t, turn));
    await answer(
      interaction,
      [t('chatbot.slash.historyTitle', { count: String(items.length) }), ...entries].join('\n\n'),
    );
  }

  @Subcommand({
    name: 'history-clear',
    description: historyClearText['en-US'],
    descriptionLocalizations: historyClearText,
  })
  async onHistoryClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const { guildId, t } = await openReply(interaction, this.locales);
    const { count } = await this.history.delete(
      guildId,
      { scope: 'user', userId: interaction.user.id, dryRun: false },
      actorOf(interaction),
    );
    await answer(interaction, t('chatbot.slash.historyCleared', { count: String(count) }));
  }
}
