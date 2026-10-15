import {
  ErrorCode,
  WORD_MAX_WORDS_DEFAULT,
  WORD_MAX_WORDS_MAX,
  WORD_MAX_WORDS_MIN,
  type ActorContext,
} from '@sab/shared';
import {
  ChannelType,
  MessageFlags,
  type ApplicationCommandOptionAllowedChannelType,
} from 'discord.js';
import {
  ChannelOption,
  Context,
  IntegerOption,
  Options,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { WordGameService } from './word-game.service.js';

const CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

const setText = localizations('word-game.commands.set.description');
const resetText = localizations('word-game.commands.reset.description');
const channelText = localizations('word-game.commands.channelOption.description');
const maxWordsText = localizations('word-game.commands.maxWordsOption.description');

class WordSetOptions {
  @ChannelOption({
    name: 'channel',
    description: channelText['en-US'],
    description_localizations: channelText,
    channel_types: CHANNEL_TYPES,
    required: true,
  })
  readonly channel!: { readonly id: string };

  @IntegerOption({
    name: 'max-words',
    description: maxWordsText['en-US'],
    description_localizations: maxWordsText,
    min_value: WORD_MAX_WORDS_MIN,
    max_value: WORD_MAX_WORDS_MAX,
    required: false,
  })
  readonly maxWords?: number;
}

/**
 * `/word set|reset`. Who may run them is decided by the group's default
 * permission in Discord; nothing is checked here. Both answer publicly, as the
 * room should see where the game is played.
 */
@DiscordCommands()
@CommandGroup.word()
export class WordGameCommands {
  constructor(
    private readonly game: WordGameService,
    private readonly guilds: GuildConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'set',
    description: setText['en-US'],
    descriptionLocalizations: setText,
  })
  async onSet(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel, maxWords }: WordSetOptions,
  ): Promise<void> {
    const guildId = this.guildOf(interaction);

    // Before the reply is deferred: a channel the bot cannot post in is refused
    // with a private answer, which a deferred public reply could not give.
    await this.guilds.assertChannelUsable('wordChannelId', channel.id);
    // The writes below, and the message posted in the channel, can outlast the
    // 3 s window for a first reply.
    await interaction.deferReply();

    await this.game.configure(
      guildId,
      { channelId: channel.id, maxWords: maxWords ?? WORD_MAX_WORDS_DEFAULT },
      this.actorOf(interaction),
    );
    await this.game.announceStart(guildId, channel.id);

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(interaction, t('word-game.confirmation', { channel: `<#${channel.id}>` }));
  }

  @Subcommand({
    name: 'reset',
    description: resetText['en-US'],
    descriptionLocalizations: resetText,
  })
  async onReset(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = this.guildOf(interaction);
    await interaction.deferReply();

    const result = await this.game.reset(guildId, this.actorOf(interaction));
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    if (result.status === 'NOT_CONFIGURED' || result.channelId === null) {
      // A public placeholder cannot be made private: it goes, and the refusal
      // is a private follow-up, as it was before the reply was deferred.
      await interaction.deleteReply();
      await interaction.followUp({
        content: t('word-game.notConfigured'),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await this.game.announceStart(guildId, result.channelId);
    await replyInChunks(
      interaction,
      t('word-game.confirmation', { channel: `<#${result.channelId}>` }),
    );
  }

  /** The commands are offered in direct messages too (see AGENTS.md); there is no game there. */
  private guildOf(interaction: SlashCommandContext[0]): string {
    if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return interaction.guildId;
  }

  private actorOf(interaction: SlashCommandContext[0]): ActorContext {
    return { source: 'DISCORD', userId: interaction.user.id };
  }
}
