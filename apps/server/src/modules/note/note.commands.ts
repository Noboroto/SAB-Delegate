import { Logger, UseInterceptors } from '@nestjs/common';
import {
  ErrorCode,
  NOTE_CONTENT_MAX_LENGTH,
  NOTE_TOPIC_MAX_LENGTH,
  type ActorContext,
  type Note,
} from '@sab/shared';
import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import {
  Context,
  Modal,
  ModalParam,
  Options,
  RoleOption,
  StringOption,
  Subcommand,
  type ModalContext,
  type SlashCommandContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { NoteTopicAutocompleteInterceptor } from './note-topic.autocomplete.js';
import { NoteService } from './note.service.js';

const addText = localizations('note.commands.add.description');
const getText = localizations('note.commands.get.description');
const removeText = localizations('note.commands.remove.description');
const roleText = localizations('note.commands.roleOption.description');
const topicText = localizations('note.commands.topicOption.description');
const contentText = localizations('note.commands.contentOption.description');

type RoleRef = { readonly id: string; readonly name: string };

export class NoteAddOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: RoleRef;

  @StringOption({
    name: 'topic',
    description: topicText['en-US'],
    description_localizations: topicText,
    required: true,
    autocomplete: true,
    min_length: 1,
    max_length: NOTE_TOPIC_MAX_LENGTH,
  })
  readonly topic!: string;

  /** Left out, the command opens a dialog for the text instead. */
  @StringOption({
    name: 'content',
    description: contentText['en-US'],
    description_localizations: contentText,
    required: false,
    min_length: 1,
    max_length: NOTE_CONTENT_MAX_LENGTH,
  })
  readonly content?: string;
}

export class NoteGetOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: RoleRef;
}

export class NoteRemoveOptions {
  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: true,
  })
  readonly role!: RoleRef;

  @StringOption({
    name: 'topic',
    description: topicText['en-US'],
    description_localizations: topicText,
    required: true,
    autocomplete: true,
    min_length: 1,
    max_length: NOTE_TOPIC_MAX_LENGTH,
  })
  readonly topic!: string;
}

/** The id of the dialog `/note add` opens; the role rides along, the rest is typed in. */
const ADD_MODAL_PREFIX = 'note-add';
const TOPIC_INPUT = 'topic';
const CONTENT_INPUT = 'content';
/** A dialog text field holds fewer characters than a command option does. */
const MODAL_CONTENT_MAX_LENGTH = 4000;

type Answerable = Parameters<typeof replyInChunks>[0] & {
  readonly user: { readonly id: string };
  readonly locale: string;
};

/**
 * `/note add|get|remove`. Who may run them is decided by Discord's command
 * permissions; nothing is checked here. Answers are public, as before: the
 * notes are shared by the room that keeps them.
 */
@DiscordCommands()
@CommandGroup.note()
export class NoteCommands {
  private readonly logger = new Logger(NoteCommands.name);

  constructor(
    private readonly notes: NoteService,
    private readonly locales: GuildLocaleService,
  ) {}

  @UseInterceptors(NoteTopicAutocompleteInterceptor)
  @Subcommand({
    name: 'add',
    description: addText['en-US'],
    descriptionLocalizations: addText,
  })
  async onAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, topic, content }: NoteAddOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);

    if (content === undefined) {
      // A dialog must be the first response, so nothing is deferred or read
      // before it. Its language is the invoker's own, which needs no lookup.
      await showModalFirst(interaction, buildAddModal(interaction.locale, role.id, topic));
      return;
    }

    // The write can outlast the 3 s window for a first reply.
    await interaction.deferReply();
    await this.save(interaction, guildId, role, { topic, content });
  }

  /** The dialog `/note add` opened: a blank text is refused by the service like a typed one. */
  @Modal(`${ADD_MODAL_PREFIX}/:roleId`)
  async onAddModal(
    @Context() [interaction]: ModalContext,
    @ModalParam('roleId') roleId: string,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const topic = interaction.fields.getTextInputValue(TOPIC_INPUT);
    const content = interaction.fields.getTextInputValue(CONTENT_INPUT);

    await interaction.deferReply();
    const role = { id: roleId, name: await this.roleName(interaction.guild, roleId) };
    await this.save(interaction, guildId, role, { topic, content });
  }

  /**
   * The dialog carries only the role id, and the cache may not hold the role
   * (it was deleted, or the guild was not fully loaded), so it is asked for
   * before giving up. The mention text is the last resort: it shows the role
   * to the people reading and, with the client's no-ping default, notifies
   * nobody.
   */
  private async roleName(
    guild: {
      roles: {
        cache: Map<string, { name: string }>;
        fetch(id: string): Promise<{ name: string } | null>;
      };
    } | null,
    roleId: string,
  ): Promise<string> {
    const cached = guild?.roles.cache.get(roleId);
    if (cached !== undefined) return `@${cached.name}`;
    try {
      const fetched = await guild?.roles.fetch(roleId);
      if (fetched) return `@${fetched.name}`;
    } catch (error) {
      this.logger.warn(`Could not fetch role ${roleId} for a note (${errorLabel(error)})`);
    }
    return `<@&${roleId}>`;
  }

  @Subcommand({
    name: 'get',
    description: getText['en-US'],
    descriptionLocalizations: getText,
  })
  async onGet(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role }: NoteGetOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply();

    const notes = await this.notes.listByRole(guildId, role.id);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t('note.list', { role: `@${role.name}`, notes: toJson(notes) }),
    );
  }

  @UseInterceptors(NoteTopicAutocompleteInterceptor)
  @Subcommand({
    name: 'remove',
    description: removeText['en-US'],
    descriptionLocalizations: removeText,
  })
  async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role, topic }: NoteRemoveOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply();

    await this.notes.remove(guildId, { roleId: role.id, topic }, actorOf(interaction));
    // Said whether or not the topic existed, as before: the room asked for it to be gone.
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t('note.removed', { role: `@${role.name}`, topic: topic.trim() }),
    );
  }

  private async save(
    interaction: Answerable,
    guildId: string,
    role: RoleRef,
    note: { topic: string; content: string },
  ): Promise<void> {
    const saved = await this.notes.upsert(
      guildId,
      { roleId: role.id, ...note },
      actorOf(interaction),
    );
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t('note.saved', { role: `@${role.name}`, topic: saved.topic }),
    );
  }
}

/** Notes are kept per server; the commands are offered in direct messages too (see AGENTS.md). */
function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/** `{ topic: text }` in the order the notes were first saved; `{}` for a role with none. */
function toJson(notes: readonly Pick<Note, 'topic' | 'content'>[]): string {
  return JSON.stringify(
    Object.fromEntries(notes.map((note) => [note.topic, note.content])),
    null,
    2,
  );
}

function buildAddModal(locale: string, roleId: string, topic: string): ModalBuilder {
  const t = translatorFor(locale);

  const topicInput = new TextInputBuilder()
    .setCustomId(TOPIC_INPUT)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(NOTE_TOPIC_MAX_LENGTH);
  // A value that is only spaces would make the dialog unsubmittable.
  const prefill = topic.trim();
  if (prefill !== '') topicInput.setValue(prefill);

  const contentInput = new TextInputBuilder()
    .setCustomId(CONTENT_INPUT)
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMinLength(1)
    .setMaxLength(Math.min(NOTE_CONTENT_MAX_LENGTH, MODAL_CONTENT_MAX_LENGTH));

  return new ModalBuilder()
    .setCustomId(`${ADD_MODAL_PREFIX}/${roleId}`)
    .setTitle(t('note.modal.title'))
    .addLabelComponents(
      new LabelBuilder().setLabel(t('note.modal.topicLabel')).setTextInputComponent(topicInput),
      new LabelBuilder().setLabel(t('note.modal.contentLabel')).setTextInputComponent(contentInput),
    );
}
