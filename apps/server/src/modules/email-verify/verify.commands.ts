import { Context, Subcommand, type SlashCommandContext } from 'necord';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { PRIVATE, guildOf, subcommandMeta } from './email-verify.command-support.js';
import { buildEmailModal, serverTextOf } from './email-verify.forms.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';

/**
 * `/verify start|delete-data`: every member's own commands. Who may run them
 * is decided by Discord (they are offered to everyone, in servers only);
 * nothing is checked here. Every answer is private.
 */
@DiscordCommands()
@CommandGroup.verify()
export class VerifyCommands {
  constructor(
    private readonly config: EmailVerifyConfigService,
    private readonly members: EmailVerifyMembersService,
    private readonly locales: GuildLocaleService,
  ) {}

  /** Opens the address form; a form must be the first response, so nothing is deferred. */
  @Subcommand(subcommandMeta('verify.start', 'start'))
  async onStart(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    const text = await serverTextOf(this.config, guildId);
    await showModalFirst(interaction, buildEmailModal(interaction.locale, guildId, text));
  }

  @Subcommand(subcommandMeta('verify.deleteData', 'delete-data'))
  async onDeleteData(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const deleted = await this.members.deleteOwnData(guildId, interaction.user.id);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t(deleted ? 'email-verify.verify.deleted' : 'email-verify.verify.nothingToDelete'),
      { ephemeral: true },
    );
  }
}
