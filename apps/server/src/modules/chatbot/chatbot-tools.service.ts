import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelGameSchema, LEADERBOARD_SIZE, MiniGameSchema, z, type Locale } from '@sab/shared';
import { tool, type ToolSet } from 'ai';
import { Client } from 'discord.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { birthdayDatesFor, businessDayOf } from '../birthday/birthday.date.js';
import { BirthdayService } from '../birthday/birthday.service.js';
import { GameChannelService } from '../game-core/game-channel.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { CommandsCatalogService } from '../system/commands-catalog.service.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotHistoryService } from './chatbot-history.service.js';
import { ChatbotIntroService } from './chatbot-intro.service.js';
import { resetMarkup } from './chatbot-period.js';
import { ChatbotQuotaService } from './chatbot-quota.service.js';
import {
  fitResult,
  mentionOf,
  shortName,
  UNAVAILABLE,
  untrustedText,
} from './chatbot-tool-output.js';

/** Most of the asker's own turns `my_recent_turns` returns. */
const RECENT_TURNS_SHOWN = 5;
const TURN_QUESTION_MAX = 300;
const TURN_ANSWER_MAX = 500;
const MAX_UPCOMING_DAYS = 31;
const DAY_MS = 86_400_000;
const COMMAND_TEXT_MAX = 200;

/**
 * Who the tools answer for. The server and the asker are fixed here, outside
 * anything the model writes: no tool takes either as an argument.
 */
type ToolScope = {
  guildId: string;
  askerId: string;
  locale: Locale;
  /** Tokens set aside for this very turn: the asker is not out of allowance because of them. */
  held: number;
  /** The model answering this turn, as `resolveTarget` chose it. */
  model: { name: string; source: 'guild' | 'global' };
};

/**
 * The read-only tools of the chatbot, built per reply. Each one reads public
 * data of the asker's own server, or the asker's own allowance and turns; a
 * failure becomes a short code, never provider or database text.
 */
@Injectable()
export class ChatbotToolsService {
  private readonly logger = new Logger(ChatbotToolsService.name);

  constructor(
    private readonly commands: CommandsCatalogService,
    private readonly leaderboard: LeaderboardService,
    private readonly gameChannels: GameChannelService,
    private readonly guilds: GuildConfigService,
    private readonly chatbot: ChatbotConfigService,
    private readonly birthdays: BirthdayService,
    private readonly quota: ChatbotQuotaService,
    private readonly history: ChatbotHistoryService,
    private readonly intro: ChatbotIntroService,
    @Inject(Client) private readonly client: Client,
  ) {}

  build(scope: ToolScope): ToolSet {
    const { guildId, askerId } = scope;
    return {
      list_commands: tool({
        description:
          "List the bot's slash commands with their subcommands and what each does, in the server's language. Use it for any question about how to use the bot; optionally filter by a word.",
        inputSchema: z.object({ query: z.string().trim().max(50).optional() }),
        execute: ({ query }) =>
          this.run('list_commands', () => {
            const needle = query?.toLowerCase();
            const entries = this.commands
              .list(scope.locale)
              .filter(
                (entry) =>
                  needle === undefined ||
                  entry.name.toLowerCase().includes(needle) ||
                  entry.description.toLowerCase().includes(needle) ||
                  entry.subcommands.some(
                    (sub) =>
                      sub.name.toLowerCase().includes(needle) ||
                      sub.description.toLowerCase().includes(needle),
                  ),
              )
              .map((entry) => ({
                command: `/${entry.name}`,
                description: untrustedText(entry.description, COMMAND_TEXT_MAX),
                restricted: entry.defaultMemberPermissions !== null,
                subcommands: entry.subcommands.map((sub) => ({
                  command: `/${sub.name}`,
                  description: untrustedText(sub.description, COMMAND_TEXT_MAX),
                })),
              }));
            return fitResult({ commands: entries }, 'commands');
          }),
      }),

      game_leaderboard: tool({
        description:
          "The top players of one of this server's games and the asker's own rank. Games: WORD_CHAIN, and the channel games.",
        inputSchema: z.object({
          game: MiniGameSchema,
          limit: z.number().int().min(1).max(LEADERBOARD_SIZE).default(5),
        }),
        execute: ({ game, limit }) =>
          this.run('game_leaderboard', async () => {
            const board = await this.leaderboard.board(guildId, game, askerId);
            const row = (r: { userId: string; points: number; rank: number }) => ({
              rank: r.rank,
              member: mentionOf(r.userId),
              points: r.points,
            });
            return fitResult(
              { game, top: board.top.slice(0, limit).map(row), you: board.you && row(board.you) },
              'top',
            );
          }),
      }),

      server_channels: tool({
        description:
          'Which channels of this server play the games, the word chain and the chatbot, and whether the chatbot is on.',
        inputSchema: z.object({}),
        execute: () =>
          this.run('server_channels', async () => {
            const [settings, chatbot, ...games] = await Promise.all([
              this.guilds.get(guildId),
              this.chatbot.get(guildId),
              ...ChannelGameSchema.options.map((game) =>
                this.gameChannels.channelOf(guildId, game),
              ),
            ]);
            const channel = (id: string | null) =>
              id === null ? null : { channel: `<#${id}>`, name: this.channelName(guildId, id) };
            return fitResult(
              {
                wordChain: channel(settings.wordChannelId),
                introductions: channel(settings.introChannelId),
                birthdays: channel(settings.birthdayChannelId),
                games: ChannelGameSchema.options.map((game, index) => ({
                  game,
                  ...(channel(games[index] ?? null) ?? { channel: null }),
                })),
                chatbot: { enabled: chatbot.enabled, channels: chatbot.channels.map(channel) },
              },
              'games',
            );
          }),
      }),

      birthdays: tool({
        description:
          'Member birthdays of this server (day and month only). Give a month (1-12), or upcomingDays to see who is next; with neither, this month.',
        inputSchema: z.object({
          month: z.number().int().min(1).max(12).optional(),
          upcomingDays: z.number().int().min(1).max(MAX_UPCOMING_DAYS).optional(),
        }),
        execute: ({ month, upcomingDays }) =>
          this.run('birthdays', async () => {
            const today = businessDayOf(new Date());
            const wanted =
              upcomingDays === undefined
                ? null
                : new Set(
                    Array.from({ length: upcomingDays + 1 }, (_, i) =>
                      businessDayOf(new Date(Date.now() + i * DAY_MS)),
                    ).flatMap((day) => birthdayDatesFor(day).map((d) => `${d.month}-${d.day}`)),
                  );
            const months =
              wanted === null
                ? [month ?? today.month]
                : [...new Set([...wanted].map((key) => Number(key.split('-')[0])))];
            const lists = await Promise.all(
              months.map((m) => this.birthdays.list(guildId, { month: m })),
            );
            const entries = lists
              .flat()
              .filter((e) => wanted === null || wanted.has(`${e.month}-${e.day}`))
              .sort((a, b) => a.month - b.month || a.day - b.day);
            return fitResult(
              {
                birthdays: entries.map((e) => ({
                  who: e.discordId === null ? shortName(e.name) : mentionOf(e.discordId),
                  day: e.day,
                  month: e.month,
                })),
              },
              'birthdays',
            );
          }),
      }),

      my_quota: tool({
        description:
          "The asker's own token allowance this month: used, remaining, total and when it renews.",
        inputSchema: z.object({}),
        execute: () =>
          this.run('my_quota', async () => {
            const q = await this.quota.limitOf(guildId, askerId);
            return {
              // The hold for this reply is not spending yet: add it back.
              used: Math.max(0, q.used - scope.held),
              remaining: Math.min(q.total, q.remaining + scope.held),
              total: q.total,
              renews: resetMarkup(new Date()),
            };
          }),
      }),

      my_recent_turns: tool({
        description:
          "The asker's own latest exchanges with you in this server (never anyone else's).",
        inputSchema: z.object({}),
        execute: () =>
          this.run('my_recent_turns', async () => {
            const turns = await this.history.recentFor(guildId, askerId);
            return fitResult(
              {
                turns: turns
                  .slice(-RECENT_TURNS_SHOWN)
                  .reverse()
                  .map((turn) => ({
                    at: turn.createdAt,
                    asked: untrustedText(turn.question, TURN_QUESTION_MAX),
                    answered: untrustedText(turn.answer, TURN_ANSWER_MAX),
                  })),
              },
              'turns',
            );
          }),
      }),

      get_intro: tool({
        description:
          "A member's self-introduction from this server's introductions channel. Give their mention or id, or their display name; if several members match, ask which one.",
        inputSchema: z.object({ member: z.string().trim().min(1).max(100) }),
        execute: ({ member }, { abortSignal }) =>
          this.run('get_intro', async () =>
            fitOne(await this.intro.lookup(guildId, member, abortSignal)),
          ),
      }),

      current_model: tool({
        description: 'The name of the model that is answering this message.',
        inputSchema: z.object({}),
        execute: () => ({ model: scope.model.name, source: scope.model.source }),
      }),
    };
  }

  /** A tool never throws: whatever goes wrong is logged here and the model gets a code. */
  private async run<T>(name: string, work: () => T | Promise<T>): Promise<T | typeof UNAVAILABLE> {
    try {
      return await work();
    } catch (error) {
      this.logger.warn(`Chatbot tool ${name} failed (${errorLabel(error)})`);
      return UNAVAILABLE;
    }
  }

  private channelName(guildId: string, channelId: string): string | null {
    const channel = this.client.guilds.cache.get(guildId)?.channels.cache.get(channelId);
    return channel === undefined ? null : shortName(channel.name);
  }
}

/** A result with no list: it is already small by construction, but the cap is enforced anyway. */
function fitOne(result: Record<string, unknown>) {
  return fitResult(result, 'status');
}
