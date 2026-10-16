import { ErrorCode, type ActorContext } from '@sab/shared';
import { ChannelType, type ApplicationCommandOptionAllowedChannelType } from 'discord.js';
import { ChannelOption, Context, Subcommand, type SlashCommandContext } from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { GuildConfigService, type ChannelSetting } from './guild-config.service.js';

const CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.AnnouncementThread,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
];

const channelOptionText = localizations('guild-config.commands.channelOption.description');

export class ChannelOptions {
  @ChannelOption({
    name: 'channel',
    description: channelOptionText['en-US'],
    description_localizations: channelOptionText,
    channel_types: CHANNEL_TYPES,
    required: true,
  })
  readonly channel!: { readonly id: string };
}

type ConfirmationKey =
  | 'guild-config.set.introChannel'
  | 'guild-config.set.logChannel'
  | 'guild-config.set.birthdayChannel';

const intro = localizations('guild-config.commands.introChannel.description');
const log = localizations('guild-config.commands.logChannel.description');
const birthday = localizations('guild-config.commands.birthdayChannel.description');

/**
 * `/set intro-channel|log-channel|birthday-channel`. Who may run them is
 * decided by the group's default permission in Discord; nothing is checked
 * here. The command only turns the options into a service call and the result
 * into a reply.
 */
@DiscordCommands()
@CommandGroup.set()
export class GuildConfigCommands {
  constructor(
    private readonly config: GuildConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'intro-channel',
    description: intro['en-US'],
    descriptionLocalizations: intro,
  })
  async onIntroChannel(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: ChannelOptions,
  ): Promise<void> {
    await this.setChannel(
      interaction,
      'introChannelId',
      channel.id,
      'guild-config.set.introChannel',
    );
  }

  @Subcommand({
    name: 'log-channel',
    description: log['en-US'],
    descriptionLocalizations: log,
  })
  async onLogChannel(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: ChannelOptions,
  ): Promise<void> {
    await this.setChannel(interaction, 'logChannelId', channel.id, 'guild-config.set.logChannel');
  }

  @Subcommand({
    name: 'birthday-channel',
    description: birthday['en-US'],
    descriptionLocalizations: birthday,
  })
  async onBirthdayChannel(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel }: ChannelOptions,
  ): Promise<void> {
    await this.setChannel(
      interaction,
      'birthdayChannelId',
      channel.id,
      'guild-config.set.birthdayChannel',
    );
  }

  private async setChannel(
    interaction: SlashCommandContext[0],
    setting: ChannelSetting,
    channelId: string,
    confirmation: ConfirmationKey,
  ): Promise<void> {
    // The command is offered in direct messages too (see AGENTS.md); there is
    // no server there to configure.
    const guildId = interaction.guildId;
    if (guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);

    // Before the reply is deferred: a channel the bot cannot use is refused
    // with a private answer, which a deferred public reply could not give.
    await this.config.assertChannelUsable(setting, channelId);

    // The database write below can outlast the 3 s window for a first reply.
    // Public, as before: the confirmation tells the room where the bot now works.
    await interaction.deferReply();

    const actor: ActorContext = { source: 'DISCORD', userId: interaction.user.id };
    await this.config.patch(guildId, { [setting]: channelId }, actor);

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(interaction, t(confirmation, { channel: `<#${channelId}>` }));
  }
}
