import {
  EMAIL_LISTS_MAX,
  EMAIL_LIST_BATCH_MAX,
  EMAIL_LIST_ENTRIES_MAX,
  type EmailListEntriesResult,
} from '@sab/shared';
import {
  AttachmentOption,
  Context,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { EmailListGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { Options } from '../../discord/decorators/options.decorator.js';
import { showResult } from '../../discord/helpers/confirm-buttons.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { EmailListService } from './email-list.service.js';
import { UPLOAD_MAX_BYTES, readUpload } from './email-list-upload.js';
import {
  NO_PING,
  PRIVATE,
  actorOf,
  confirmed,
  guildOf,
  optionMeta,
  splitItems,
  subcommandMeta,
  type Translate,
} from './email-verify.command-support.js';

/** The longest text one option takes. */
const EMAILS_OPTION_MAX = 6000;

class ListNameOptions {
  @StringOption({
    name: 'name',
    ...optionMeta('name'),
    required: true,
    min_length: 1,
    max_length: 32,
  })
  readonly name!: string;
}

class ListEmailsOptions extends ListNameOptions {
  @StringOption({
    name: 'emails',
    ...optionMeta('emails'),
    required: true,
    min_length: 1,
    max_length: EMAILS_OPTION_MAX,
  })
  readonly emails!: string;
}

// Declared flat: a subclass's own options register before the inherited ones, which would put the
// required name after the optional mode and make Discord reject the command.
class ListUploadOptions {
  @StringOption({
    name: 'name',
    ...optionMeta('name'),
    required: true,
    min_length: 1,
    max_length: 32,
  })
  readonly name!: string;

  @AttachmentOption({ name: 'file', ...optionMeta('file'), required: true })
  readonly file!: Parameters<typeof readUpload>[0];

  @StringOption({
    name: 'mode',
    ...optionMeta('mode'),
    required: false,
    choices: [
      { name: 'add', value: 'add' },
      { name: 'remove', value: 'remove' },
    ],
  })
  readonly mode?: 'add' | 'remove';
}

const NOTHING: EmailListEntriesResult = { changed: 0, skipped: 0, invalid: 0 };

/** Several batches' results as one. */
function total(parts: readonly EmailListEntriesResult[]): EmailListEntriesResult {
  return parts.reduce<EmailListEntriesResult>(
    (sum, part) => ({
      changed: sum.changed + part.changed,
      skipped: sum.skipped + part.skipped,
      invalid: sum.invalid + part.invalid,
    }),
    NOTHING,
  );
}

function* batches<T>(items: readonly T[]): Generator<T[]> {
  for (let start = 0; start < items.length; start += EMAIL_LIST_BATCH_MAX) {
    yield items.slice(start, start + EMAIL_LIST_BATCH_MAX);
  }
}

/** The answer to adding to (or removing from) a list, in the server's language. */
function entriesText(
  t: Translate,
  mode: 'add' | 'remove',
  name: string,
  result: EmailListEntriesResult,
): string {
  return mode === 'add'
    ? t('email-verify.list.added', {
        name,
        added: result.changed,
        skipped: result.skipped,
        invalid: result.invalid,
      })
    : t('email-verify.list.removedEntries', {
        name,
        removed: result.changed,
        skipped: result.skipped,
        invalid: result.invalid,
      });
}

/**
 * `/email-list create|delete|add|remove|upload|clear|show`: named lists of
 * addresses that access rules can refer to (`list:k21`). An address is kept
 * only as a hash, so no command can show one back. Who may run them is decided
 * by the group's default permission in Discord; nothing is checked here.
 * Answers are private.
 */
@DiscordCommands()
@EmailListGroup()
export class EmailListCommands {
  constructor(
    private readonly lists: EmailListService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand(subcommandMeta('emailList.create', 'create'))
  async onCreate(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name }: ListNameOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    if ((await this.lists.list(guildId)).length >= EMAIL_LISTS_MAX) {
      await this.say(interaction, t('email-verify.list.limit', { max: EMAIL_LISTS_MAX }));
      return;
    }
    const created = await this.lists.create(guildId, { name }, actorOf(interaction));
    await this.say(interaction, t('email-verify.list.created', { name: created.name }));
  }

  @Subcommand(subcommandMeta('emailList.delete', 'delete'))
  async onDelete(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name }: ListNameOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const actor = actorOf(interaction);
    const listId = await this.lists.idOfName(guildId, name);

    const loss = await this.lists.delete(guildId, listId, actor, { dryRun: true });
    const prompt = t('email-verify.confirm.listDelete', {
      name: loss.listName,
      count: loss.entries,
    });
    if (!(await confirmed(interaction, t, prompt))) return;

    await this.lists.delete(guildId, listId, actor);
    await showResult(interaction, t('email-verify.list.deleted', { name: loss.listName }));
  }

  @Subcommand(subcommandMeta('emailList.add', 'add'))
  async onAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name, emails }: ListEmailsOptions,
  ): Promise<void> {
    await this.change(interaction, name, splitItems(emails), 'add');
  }

  @Subcommand(subcommandMeta('emailList.remove', 'remove'))
  async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name, emails }: ListEmailsOptions,
  ): Promise<void> {
    await this.change(interaction, name, splitItems(emails), 'remove');
  }

  @Subcommand(subcommandMeta('emailList.upload', 'upload'))
  async onUpload(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name, file, mode }: ListUploadOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const upload = await readUpload(file);
    if (!upload.ok) {
      const key = {
        TYPE: 'email-verify.list.fileType',
        TOO_BIG: 'email-verify.list.fileTooBig',
        UNREADABLE: 'email-verify.list.fileUnreadable',
        EMPTY: 'email-verify.list.fileEmpty',
      } as const;
      await this.say(interaction, t(key[upload.reason], { size: UPLOAD_MAX_BYTES / 1024 }));
      return;
    }
    await this.apply(interaction, guildId, t, name, upload.items, mode ?? 'add');
  }

  @Subcommand(subcommandMeta('emailList.clear', 'clear'))
  async onClear(
    @Context() [interaction]: SlashCommandContext,
    @Options() { name }: ListNameOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const actor = actorOf(interaction);
    const listId = await this.lists.idOfName(guildId, name);

    const loss = await this.lists.clearEntries(guildId, listId, actor, { dryRun: true });
    const prompt = t('email-verify.confirm.listClear', {
      name: loss.listName,
      count: loss.entries,
    });
    if (!(await confirmed(interaction, t, prompt))) return;

    await this.lists.clearEntries(guildId, listId, actor);
    await showResult(interaction, t('email-verify.list.cleared', { name: loss.listName }));
  }

  @Subcommand(subcommandMeta('emailList.show', 'show'))
  async onShow(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const lists = await this.lists.list(guildId);
    const text =
      lists.length === 0
        ? t('email-verify.list.showEmpty')
        : [
            `**${t('email-verify.list.showTitle')}**`,
            ...lists.map((list) =>
              t('email-verify.list.showItem', { name: list.name, count: list.entryCount }),
            ),
          ].join('\n');
    await this.say(interaction, text);
  }

  private async change(
    interaction: SlashCommandContext[0],
    name: string,
    items: string[],
    mode: 'add' | 'remove',
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await this.apply(interaction, guildId, t, name, items, mode);
  }

  /** Adds or removes `items` in batches the service accepts and says the totals. */
  private async apply(
    interaction: SlashCommandContext[0],
    guildId: string,
    t: Translate,
    name: string,
    items: readonly string[],
    mode: 'add' | 'remove',
  ): Promise<void> {
    const listId = await this.lists.idOfName(guildId, name);
    const listName = name.trim().toLowerCase();
    if (items.length === 0) {
      await this.say(interaction, entriesText(t, mode, listName, NOTHING));
      return;
    }
    if (mode === 'add' && items.length > EMAIL_LIST_ENTRIES_MAX) {
      await this.say(interaction, t('email-verify.list.full', { max: EMAIL_LIST_ENTRIES_MAX }));
      return;
    }
    const actor = actorOf(interaction);
    const parts: EmailListEntriesResult[] = [];
    for (const emails of batches(items)) {
      parts.push(
        mode === 'add'
          ? await this.lists.addEntries(guildId, listId, { emails }, actor)
          : await this.lists.removeEntries(guildId, listId, { emails }, actor),
      );
    }
    await this.say(interaction, entriesText(t, mode, listName, total(parts)));
  }

  private async say(interaction: SlashCommandContext[0], text: string): Promise<void> {
    await replyInChunks(interaction, text, { ephemeral: true, allowedMentions: NO_PING });
  }
}
