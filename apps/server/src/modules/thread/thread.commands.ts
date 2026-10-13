import {
  ErrorCode,
  THREAD_FAILURE_REASON,
  THREAD_MESSAGE_MAX_LENGTH,
  THREAD_NAME_MAX_LENGTH,
  type ActorContext,
  type ThreadBatchResult,
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
  Options,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { ThreadGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { confirmWithButtons, showResult } from '../../discord/helpers/confirm-buttons.js';
import { ThreadService } from './thread.service.js';

const DESTINATION_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
];

const createText = localizations('thread.commands.create.description');
const editPrefixText = localizations('thread.commands.editPrefix.description');
const removeText = localizations('thread.commands.removeByPrefix.description');
const nameText = localizations('thread.commands.nameOption.description');
const messageText = localizations('thread.commands.messageOption.description');
const isPrivateText = localizations('thread.commands.isPrivateOption.description');
const destinationText = localizations('thread.commands.destinationOption.description');
const oldPrefixText = localizations('thread.commands.oldPrefixOption.description');
const newPrefixText = localizations('thread.commands.newPrefixOption.description');
const prefixText = localizations('thread.commands.prefixOption.description');

type Destination = { readonly id: string };

class ThreadCreateOptions {
  @StringOption({
    name: 'name',
    description: nameText['en-US'],
    description_localizations: nameText,
    required: true,
    min_length: 1,
    max_length: THREAD_NAME_MAX_LENGTH,
  })
  readonly name!: string;

  @StringOption({
    name: 'message',
    description: messageText['en-US'],
    description_localizations: messageText,
    required: true,
    min_length: 1,
    max_length: THREAD_MESSAGE_MAX_LENGTH,
  })
  readonly message!: string;

  @BooleanOption({
    name: 'is-private',
    description: isPrivateText['en-US'],
    description_localizations: isPrivateText,
    required: false,
  })
  readonly isPrivate?: boolean;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  })
  readonly destination?: Destination;
}

class ThreadEditPrefixOptions {
  @StringOption({
    name: 'old-prefix',
    description: oldPrefixText['en-US'],
    description_localizations: oldPrefixText,
    required: true,
    min_length: 1,
    max_length: THREAD_NAME_MAX_LENGTH,
  })
  readonly oldPrefix!: string;

  @StringOption({
    name: 'new-prefix',
    description: newPrefixText['en-US'],
    description_localizations: newPrefixText,
    required: true,
    max_length: THREAD_NAME_MAX_LENGTH,
  })
  readonly newPrefix!: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  })
  readonly destination?: Destination;
}

class ThreadRemoveOptions {
  @StringOption({
    name: 'prefix',
    description: prefixText['en-US'],
    description_localizations: prefixText,
    required: true,
    min_length: 1,
    max_length: THREAD_NAME_MAX_LENGTH,
  })
  readonly prefix!: string;

  @ChannelOption({
    name: 'destination',
    description: destinationText['en-US'],
    description_localizations: destinationText,
    channel_types: DESTINATION_TYPES,
    required: false,
  })
  readonly destination?: Destination;
}

/**
 * `/thread create|edit-prefix|remove-by-prefix` (`/thread everyone` lives in
 * the mention module). Who may run them is decided by the group's default
 * permission in Discord; nothing is checked here. `create` answers publicly,
 * as the room should see the new thread; the others answer privately, and
 * deleting asks for confirmation first.
 */
@DiscordCommands()
@ThreadGroup()
export class ThreadCommands {
  constructor(
    private readonly threads: ThreadService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'create',
    description: createText['en-US'],
    descriptionLocalizations: createText,
  })
  async onCreate(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name, message, isPrivate, destination }: ThreadCreateOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    // Settled before anything is deferred, so the refusal is a quick private answer.
    const blank = name.trim() === '' ? 'nameEmpty' : message.trim() === '' ? 'messageEmpty' : null;
    if (blank !== null) {
      await replyInChunks(interaction, t(`thread.create.${blank}`), { ephemeral: true });
      return;
    }

    // Creating the thread and posting in it outlast the 3 s window for a first reply.
    await interaction.deferReply();
    const result = await this.threads.create(
      guildId,
      {
        channelId: destination?.id ?? interaction.channelId,
        name,
        message,
        isPrivate: isPrivate ?? false,
        byline: t('thread.create.byline', { user: `<@${interaction.user.id}>` }),
      },
      actorOf(interaction),
    );

    if (result.threadId !== null) {
      await replyInChunks(
        interaction,
        t('thread.create.done', { thread: `<#${result.threadId}>` }),
      );
      return;
    }
    // A public placeholder cannot be made private: it goes, and the refusal is
    // a private follow-up, as it was before the reply was deferred.
    await interaction.deleteReply();
    await interaction.followUp({
      content: t(
        result.status === 'PRIVATE_NEEDS_TEXT_CHANNEL'
          ? 'thread.create.PRIVATE_NEEDS_TEXT_CHANNEL'
          : 'thread.create.CHANNEL_CANNOT_HOLD_THREADS',
      ),
      flags: MessageFlags.Ephemeral,
    });
  }

  @Subcommand({
    name: 'edit-prefix',
    description: editPrefixText['en-US'],
    descriptionLocalizations: editPrefixText,
  })
  async onEditPrefix(
    @Context() [interaction]: SlashCommandContext,
    @Options() { oldPrefix, newPrefix, destination }: ThreadEditPrefixOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = destination?.id ?? interaction.channelId;
    const result = await this.threads.renameByPrefix(
      guildId,
      { channelId, oldPrefix, newPrefix },
      actorOf(interaction),
    );
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(interaction, batchText(t, result, channelId, oldPrefix), {
      ephemeral: true,
    });
  }

  @Subcommand({
    name: 'remove-by-prefix',
    description: removeText['en-US'],
    descriptionLocalizations: removeText,
  })
  async onRemoveByPrefix(
    @Context() [interaction]: SlashCommandContext,
    @Options() { prefix, destination }: ThreadRemoveOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const channelId = destination?.id ?? interaction.channelId;
    const input = { channelId, prefix };
    const actor = actorOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    const plan = await this.threads.deleteByPrefix(guildId, input, actor, { dryRun: true });
    if (plan.status !== 'OK') {
      await showResult(interaction, t('thread.prefix.CHANNEL_CANNOT_HOLD_THREADS'));
      return;
    }
    if (plan.count === 0) {
      await showResult(
        interaction,
        t('thread.prefix.noMatch', { channel: `<#${channelId}>`, prefix }),
      );
      return;
    }

    const names = plan.sample.map((match) => `- ${match.name}`);
    if (plan.count > plan.sample.length) {
      names.push(t('thread.delete.more', { count: plan.count - plan.sample.length }));
    }
    const outcome = await confirmWithButtons(interaction, {
      prompt: t('thread.delete.prompt', {
        count: plan.count,
        channel: `<#${channelId}>`,
        prefix,
        list: names.join('\n'),
      }),
      confirmLabel: t('purge.confirm.confirmButton'),
      cancelLabel: t('purge.confirm.cancelButton'),
      working: t('thread.delete.working'),
      cancelled: t('purge.confirm.cancelled'),
      expired: t('purge.confirm.expired'),
    });
    if (outcome !== 'confirmed') return;

    const result = await this.threads.deleteByPrefix(guildId, input, actor, { dryRun: false });
    await showResult(interaction, batchText(t, result, channelId, prefix));
  }
}

type Translate = ReturnType<typeof translatorFor>;

/** "Done N thread(s)!" with a line per thread that failed. */
function batchText(
  t: Translate,
  result: ThreadBatchResult,
  channelId: string,
  prefix: string,
): string {
  if (result.status !== 'OK') return t('thread.prefix.CHANNEL_CANNOT_HOLD_THREADS');
  if (result.count === 0) {
    return t('thread.prefix.noMatch', { channel: `<#${channelId}>`, prefix });
  }
  const lines = [t('thread.prefix.done', { done: result.done })];
  if (result.failures.length > 0) {
    lines.push(t('thread.prefix.failedHeader', { count: result.failures.length }));
    for (const failure of result.failures) {
      lines.push(
        t('thread.prefix.failure', {
          name: failure.name,
          reason:
            failure.reason === THREAD_FAILURE_REASON.nameInvalid
              ? t('thread.prefix.NAME_INVALID')
              : failure.reason,
        }),
      );
    }
  }
  return lines.join('\n');
}

/** The commands are offered in direct messages too (see AGENTS.md); threads need a server. */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}
