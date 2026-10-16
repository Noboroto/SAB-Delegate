import { UseInterceptors } from '@nestjs/common';
import { ErrorCode, type ActorContext } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { Context, IntegerOption, Subcommand, type SlashCommandContext } from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { ScheduleCancelAutocompleteInterceptor } from './schedule.autocomplete.js';
import { describeCancel, formatScheduleEntry, packEntries } from './schedule.format.js';
import { ScheduleService } from './schedule.service.js';

const getText = localizations('schedule.commands.get.description');
const cancelText = localizations('schedule.commands.cancel.description');
const idText = localizations('schedule.commands.idOption.description');

export class SchedulerCancelOptions {
  @IntegerOption({
    name: 'id',
    description: idText['en-US'],
    description_localizations: idText,
    required: true,
    // No min/max: Discord does not combine them with suggestions, and the service checks the number.
    autocomplete: true,
  })
  readonly id!: number;
}

/**
 * `/scheduler get|cancel`. Who may run them is decided by the group's default
 * permission in Discord; nothing is checked here. `get` answers publicly, as
 * before, `cancel` privately.
 */
@DiscordCommands()
@CommandGroup.scheduler()
export class SchedulerCommands {
  constructor(
    private readonly schedules: ScheduleService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({ name: 'get', description: getText['en-US'], descriptionLocalizations: getText })
  async onGet(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    // Public, and acknowledged before the read, which can take a while.
    await interaction.deferReply();

    // The jobs still to run, as the previous bot listed (it only knew live ones);
    // finished and canceled ones are available through the API.
    const views = await this.schedules.list(guildId, { status: 'PENDING' });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    if (views.length === 0) {
      await replyInChunks(interaction, t('schedule.list.empty'));
      return;
    }
    await replyInChunks(interaction, t('schedule.list.header'));
    for (const message of packEntries(views.map((view) => formatScheduleEntry(t, view)))) {
      await replyInChunks(interaction, message);
    }
  }

  @UseInterceptors(ScheduleCancelAutocompleteInterceptor)
  @Subcommand({
    name: 'cancel',
    description: cancelText['en-US'],
    descriptionLocalizations: cancelText,
  })
  async onCancel(
    @Context() [interaction]: SlashCommandContext,
    @Options() { id }: SchedulerCancelOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await this.schedules.cancel(guildId, id, actorOf(interaction));
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(interaction, describeCancel(t, result), { ephemeral: true });
  }
}

/** The commands are offered in direct messages too (see AGENTS.md); there is no list there. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}
