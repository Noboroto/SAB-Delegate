import {
  ChannelGameSchema,
  ErrorCode,
  MiniGameSchema,
  SkippableGameSchema,
  type ActorContext,
  type ChannelGame,
  type MiniGame,
  z,
} from '@sab/shared';
import {
  ChannelType,
  MessageFlags,
  type APIApplicationCommandOptionChoice,
  type APIEmbed,
  type ApplicationCommandOptionAllowedChannelType,
} from 'discord.js';
import {
  ChannelOption,
  Context,
  Options,
  SlashCommand,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup, rootCommandMeta } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { GameChannelService } from '../game-core/game-channel.service.js';
import { LeaderboardService } from '../game-core/leaderboard.service.js';
import { MiniGameService, type RestartReason } from './mini-game.service.js';

const CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

const BLURPLE = 0x5865f2;

/** One choice per game, named in each language; the value is the game itself. */
function choices(games: readonly MiniGame[]): APIApplicationCommandOptionChoice<string>[] {
  return games.map((game) => {
    const names = localizations(`mini-game.names.${game}`);
    return { name: names['en-US'], name_localizations: names, value: game };
  });
}

const ALL_GAMES = MiniGameSchema.options;
const gameText = localizations('mini-game.commands.gameOption.description');
const channelText = localizations('mini-game.commands.channelOption.description');
const setText = localizations('mini-game.commands.set.description');
const resetText = localizations('mini-game.commands.reset.description');
const skipText = localizations('mini-game.commands.skip.description');

class ChannelGameOption {
  @StringOption({
    name: 'game',
    description: gameText['en-US'],
    description_localizations: gameText,
    choices: choices(ChannelGameSchema.options),
    required: true,
  })
  readonly game!: string;
}

class GameSetOptions extends ChannelGameOption {
  @ChannelOption({
    name: 'channel',
    description: channelText['en-US'],
    description_localizations: channelText,
    channel_types: CHANNEL_TYPES,
    required: true,
  })
  readonly channel!: { readonly id: string };
}

class GameSkipOptions {
  @StringOption({
    name: 'game',
    description: gameText['en-US'],
    description_localizations: gameText,
    choices: choices(SkippableGameSchema.options),
    required: true,
  })
  readonly game!: string;
}

class AnyGameOption {
  @StringOption({
    name: 'game',
    description: gameText['en-US'],
    description_localizations: gameText,
    choices: choices(ALL_GAMES),
    required: true,
  })
  readonly game!: string;
}

/** Discord offers only the listed choices; a forged value is still refused. */
function parseGame<T extends string>(schema: z.ZodType<T>, value: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

function withWarning(text: string, warning: string | null): string {
  return warning === null ? text : `${text}\n⚠️ ${warning}`;
}

/** The commands are offered in direct messages too (see AGENTS.md); there is no game there. */
function guildOf(interaction: SlashCommandContext[0]): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: SlashCommandContext[0]): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/**
 * `/game set|reset|skip`. Who may run them is decided by the group's default
 * permission in Discord; nothing is checked here. Answers are private: the
 * round's opening, posted in the game channel, is what the room sees.
 */
@DiscordCommands()
@CommandGroup.game()
export class GameCommands {
  constructor(
    private readonly games: MiniGameService,
    private readonly channels: GameChannelService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({ name: 'set', description: setText['en-US'], descriptionLocalizations: setText })
  async onSet(
    @Context() [interaction]: SlashCommandContext,
    @Options() { game: value, channel }: GameSetOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const game = parseGame(ChannelGameSchema, value);
    // The channel check against Discord and the writes can outlast the 3 s
    // window for a first reply.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    const result = await this.channels.set(guildId, game, channel.id, actorOf(interaction));
    if (result.status === 'TAKEN') {
      await interaction.editReply(
        t('mini-game.channelTaken', { game: t(`mini-game.names.${result.game}`) }),
      );
      return;
    }
    const { warning } = await this.startRound(interaction, guildId, game, 'configure', t);
    await interaction.editReply(
      withWarning(
        t('mini-game.confirmation', {
          channel: `<#${channel.id}>`,
          game: t(`mini-game.names.${game}`),
        }),
        warning,
      ),
    );
  }

  @Subcommand({
    name: 'reset',
    description: resetText['en-US'],
    descriptionLocalizations: resetText,
  })
  async onReset(
    @Context() [interaction]: SlashCommandContext,
    @Options() { game: value }: ChannelGameOption,
  ): Promise<void> {
    await this.restartFromCommand(interaction, parseGame(ChannelGameSchema, value), 'reset');
  }

  @Subcommand({ name: 'skip', description: skipText['en-US'], descriptionLocalizations: skipText })
  async onSkip(
    @Context() [interaction]: SlashCommandContext,
    @Options() { game: value }: GameSkipOptions,
  ): Promise<void> {
    await this.restartFromCommand(interaction, parseGame(SkippableGameSchema, value), 'skip');
  }

  private async restartFromCommand(
    interaction: SlashCommandContext[0],
    game: ChannelGame,
    reason: RestartReason,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { restarted, warning } = await this.startRound(interaction, guildId, game, reason, t);
    if (restarted === null) {
      await interaction.editReply(
        t('mini-game.notConfigured', { game: t(`mini-game.names.${game}`) }),
      );
      return;
    }
    const { opening } = restarted;
    const previous = opening.game === 'COUNTING' ? null : opening.previous;
    await interaction.editReply(
      withWarning(
        reason === 'skip' && previous !== null
          ? t('mini-game.skipped', { answer: previous })
          : t('mini-game.confirmation', {
              channel: `<#${restarted.channelId}>`,
              game: t(`mini-game.names.${game}`),
            }),
        warning,
      ),
    );
  }

  /**
   * The round commits, then its opening is posted in the game channel. The
   * round stands even when posting fails (the bot lost the permission, the
   * channel was deleted): the admin is told why, to fix it and reset.
   */
  private async startRound(
    interaction: SlashCommandContext[0],
    guildId: string,
    game: ChannelGame,
    reason: RestartReason,
    t: ReturnType<typeof translatorFor>,
  ) {
    const restarted = await this.games.restart(guildId, game, actorOf(interaction), reason);
    if (restarted === null) return { restarted, warning: null };
    try {
      await this.games.announce(guildId, restarted);
      return { restarted, warning: null };
    } catch (error) {
      if (!(error instanceof ServiceError)) throw error;
      return { restarted, warning: t(`errors.${error.code}`, error.params) };
    }
  }
}

/** `/leaderboard` and `/help`, for every member. */
@DiscordCommands()
export class GameInfoCommands {
  constructor(
    private readonly leaderboard: LeaderboardService,
    private readonly locales: GuildLocaleService,
  ) {}

  /**
   * Public, so a win can be shown off; the names are mentions that ping
   * nobody, so they stay readable after a player renames.
   */
  @SlashCommand(rootCommandMeta('leaderboard'))
  async onLeaderboard(
    @Context() [interaction]: SlashCommandContext,
    @Options() { game: value }: AnyGameOption,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const game = parseGame(MiniGameSchema, value);
    // Up to three queries and the locale lookup can outlast the 3 s window.
    await interaction.deferReply();
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { top, you } = await this.leaderboard.board(guildId, game, interaction.user.id);

    const rows = top.map((row) =>
      t('mini-game.leaderboard.row', {
        rank: String(row.rank),
        user: `<@${row.userId}>`,
        points: String(row.points),
      }),
    );
    const embed: APIEmbed = {
      title: t('mini-game.leaderboard.title', { game: t(`mini-game.names.${game}`) }),
      color: BLURPLE,
      description: rows.length === 0 ? t('mini-game.leaderboard.empty') : rows.join('\n'),
      footer: {
        text:
          you === null
            ? t('mini-game.leaderboard.youNone')
            : t('mini-game.leaderboard.you', {
                rank: String(you.rank),
                points: String(you.points),
              }),
      },
    };
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  }

  /** Private: it explains, nobody else needs to see it. */
  @SlashCommand(rootCommandMeta('help'))
  async onHelp(
    @Context() [interaction]: SlashCommandContext,
    @Options() { game: value }: AnyGameOption,
  ): Promise<void> {
    const game = parseGame(MiniGameSchema, value);
    const t = translatorFor(await this.locales.resolve(interaction.guildId, interaction));
    const embed: APIEmbed = {
      title: t(`mini-game.names.${game}`),
      color: BLURPLE,
      fields: [
        { name: t('mini-game.rulesTitle'), value: t(`mini-game.help.${game}.rules`) },
        { name: t('mini-game.setupTitle'), value: t(`mini-game.help.${game}.setup`) },
      ],
      footer: { text: t('mini-game.leaderboardHint') },
    };
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }
}
