import { UseInterceptors } from '@nestjs/common';
import {
  ErrorCode,
  parseSnowflakes,
  REACTION_EMOJI_MAX_LENGTH,
  type ActorContext,
  type RoleAssignResult,
} from '@sab/shared';
import { MessageFlags } from 'discord.js';
import {
  BooleanOption,
  Context,
  Options,
  RoleOption,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { BulkAssignGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { ReactionAutocompleteInterceptor } from '../../discord/interceptors/reaction-autocomplete.interceptor.js';
import { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { RoleAssignService } from './role-assign.service.js';

const listText = localizations('role-assign.commands.list.description');
const byReactionText = localizations('role-assign.commands.byReaction.description');
const idsText = localizations('role-assign.commands.idsOption.description');
const membersOfRoleText = localizations('role-assign.commands.membersOfRoleOption.description');
const roleText = localizations('role-assign.commands.roleOption.description');
const isRemoveText = localizations('role-assign.commands.isRemoveOption.description');
const messageLinkText = localizations('role-assign.commands.messageLinkOption.description');
const emojiText = localizations('role-assign.commands.emojiOption.description');

/** A text option holds up to 6000 characters; more ids than the service takes cannot fit anyway. */
const IDS_OPTION_MAX_LENGTH = 6000;

type RoleRef = { readonly id: string };

class ListOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: RoleRef;

  @StringOption({
    name: 'ids',
    description: idsText['en-US'],
    description_localizations: idsText,
    required: false,
    max_length: IDS_OPTION_MAX_LENGTH,
  })
  readonly ids?: string;

  @RoleOption({
    name: 'members-of-role',
    description: membersOfRoleText['en-US'],
    description_localizations: membersOfRoleText,
    required: false,
  })
  readonly membersOfRole?: RoleRef;

  @BooleanOption({
    name: 'is-remove',
    description: isRemoveText['en-US'],
    description_localizations: isRemoveText,
    required: false,
  })
  readonly isRemove?: boolean;
}

/** The option the emoji suggestions read the message from; see `ReactionAutocompleteInterceptor`. */
class ByReactionOptions {
  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    autocomplete: true,
    max_length: REACTION_EMOJI_MAX_LENGTH,
  })
  readonly emoji!: string;

  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: RoleRef;

  @BooleanOption({
    name: 'is-remove',
    description: isRemoveText['en-US'],
    description_localizations: isRemoveText,
    required: false,
  })
  readonly isRemove?: boolean;
}

/**
 * `/bulk-assign list|by-reaction`. Who may run them is decided by the group's
 * default permission in Discord; nothing is checked here. Answers are private:
 * the list of who was changed (and who failed) is for the person who ran it.
 */
@DiscordCommands()
@BulkAssignGroup()
export class RoleAssignCommands {
  constructor(
    private readonly roles: RoleAssignService,
    private readonly resolver: MessageResolver,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'list',
    description: listText['en-US'],
    descriptionLocalizations: listText,
  })
  async onList(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, ids, membersOfRole, isRemove }: ListOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    // Mentions, commas and stray text are all accepted; only member ids survive.
    const userIds = parseSnowflakes(ids ?? '');
    if (userIds.length === 0 && membersOfRole === undefined) {
      await interaction.editReply({ content: t('role-assign.noTargets') });
      return;
    }

    const result = await this.roles.applyToMembers(
      guildId,
      { roleId: role.id, userIds, membersOfRoleId: membersOfRole?.id, remove: isRemove ?? false },
      actorOf(interaction),
    );
    await replyInChunks(interaction, render(t, result), { ephemeral: true });
  }

  @UseInterceptors(ReactionAutocompleteInterceptor)
  @Subcommand({
    name: 'by-reaction',
    description: byReactionText['en-US'],
    descriptionLocalizations: byReactionText,
  })
  async onByReaction(
    @Context() [interaction]: SlashCommandContext,
    @Options() { messageLink, emoji, role, isRemove }: ByReactionOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    const found = await this.resolver.fetch(
      messageLink,
      interaction.channelId === null ? {} : { channelId: interaction.channelId },
    );
    if (found.status !== 'OK') {
      const content =
        found.status === 'INVALID_LINK'
          ? t(`errors.invalidLink.${found.reason}`)
          : found.status === 'NO_ACCESS'
            ? t('errors.DISCORD_MISSING_PERMISSIONS', { permission: 'view' })
            : t('errors.DISCORD_MESSAGE_NOT_FOUND');
      await interaction.editReply({ content });
      return;
    }

    // A link into another server is followed on purpose; the role is this server's.
    const result = await this.roles.applyToReactors(
      guildId,
      {
        roleId: role.id,
        channelId: found.message.channelId,
        messageId: found.message.id,
        emoji,
        remove: isRemove ?? false,
      },
      actorOf(interaction),
      { crossGuild: true },
    );
    await replyInChunks(interaction, render(t, result), { ephemeral: true });
  }
}

/** The commands are offered in direct messages too (see AGENTS.md); roles belong to a server. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/** "Done N", then what was left out and who failed; nobody reacting is said so instead of "Done 0". */
function render(t: ReturnType<typeof translatorFor>, result: RoleAssignResult): string {
  if (result.status === 'NO_REACTORS') return t('role-assign.noReactors');
  const parts = [t('role-assign.done', { count: result.done })];
  if (result.skipped > 0) parts.push(t('role-assign.skipped', { count: result.skipped }));
  if (result.failures.length > 0) {
    parts.push(
      t('role-assign.failed', {
        count: result.failures.length,
        lines: result.failures.map((failure) => `${failure.name}: ${failure.reason}`).join('\n'),
      }),
    );
  }
  return parts.join('\n');
}
