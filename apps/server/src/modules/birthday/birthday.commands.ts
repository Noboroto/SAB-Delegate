import {
  BIRTHDAY_CSV_HEADER,
  BIRTHDAY_CSV_TEMPLATE,
  ErrorCode,
  type ActorContext,
  type BirthdayImportProblem,
} from '@sab/shared';
import { MessageFlags } from 'discord.js';
import {
  AttachmentOption,
  Context,
  IntegerOption,
  StringOption,
  Subcommand,
  UserOption,
  type SlashCommandContext,
} from 'necord';
import { Options } from '../../discord/decorators/options.decorator.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { CommandGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { localizations } from '../../i18n/localizations.js';
import { translatorFor } from '../../i18n/translator.js';
import { ChannelOptions } from '../guild-config/guild-config.commands.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { BIRTHDAY_CSV_MAX_BYTES, parseBirthdayCsv } from './birthday.csv.js';
import { formatBirthdayMonths, formatImportReport } from './birthday.format.js';
import { BirthdayService } from './birthday.service.js';

const DOWNLOAD_TIMEOUT_MS = 15_000;

const appendList = localizations('birthday.commands.appendList.description');
const fileOption = localizations('birthday.commands.fileOption.description');
const getList = localizations('birthday.commands.getList.description');
const monthOption = localizations('birthday.commands.monthOption.description');
const remove = localizations('birthday.commands.remove.description');
const studentIdOption = localizations('birthday.commands.studentIdOption.description');
const userOption = localizations('birthday.commands.userOption.description');
const channel = localizations('guild-config.commands.birthdayChannel.description');

class AppendListOptions {
  @AttachmentOption({
    name: 'file',
    description: fileOption['en-US'],
    description_localizations: fileOption,
    required: true,
  })
  readonly file!: {
    readonly url: string;
    readonly size: number;
    readonly contentType: string | null;
  };
}

class GetListOptions {
  @IntegerOption({
    name: 'month',
    description: monthOption['en-US'],
    description_localizations: monthOption,
    min_value: 1,
    max_value: 12,
    required: false,
  })
  // discord.js answers null for an option the person left out.
  readonly month?: number | null;
}

class RemoveOptions {
  @StringOption({
    name: 'student-id',
    description: studentIdOption['en-US'],
    description_localizations: studentIdOption,
    required: false,
  })
  readonly studentId?: string | null;

  @UserOption({
    name: 'user',
    description: userOption['en-US'],
    description_localizations: userOption,
    required: false,
  })
  readonly user?: { readonly id: string } | null;
}

/**
 * `/birthday append-list|get-list|remove|birthday-channel`. Who may run them is
 * decided by the group's default permission in Discord; nothing is checked
 * here. The commands turn options into service calls and results into replies.
 *
 * `append-list` and `remove` answer privately, `get-list` and the channel
 * confirmation publicly, as before.
 */
@DiscordCommands()
@CommandGroup.birthday()
export class BirthdayCommands {
  constructor(
    private readonly birthdays: BirthdayService,
    private readonly config: GuildConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand({
    name: 'append-list',
    description: appendList['en-US'],
    descriptionLocalizations: appendList,
  })
  async onAppendList(
    @Context() [interaction]: SlashCommandContext,
    @Options() { file }: AppendListOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const answer = (text: string) => replyInChunks(interaction, text, { ephemeral: true });

    if (!file.contentType?.includes('csv')) return answer(t('birthday.import.notCsv'));
    if (file.size > BIRTHDAY_CSV_MAX_BYTES) return answer(t('birthday.import.tooLarge'));

    const response = await fetch(file.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) {
      return answer(t('birthday.import.downloadFailed', { status: response.status }));
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > BIRTHDAY_CSV_MAX_BYTES)
      return answer(t('birthday.import.tooLarge'));

    const parsed = parseBirthdayCsv(text);
    if (!parsed.ok) {
      return answer(
        parsed.reason === 'BAD_HEADER'
          ? t('birthday.import.badHeader', {
              header: BIRTHDAY_CSV_HEADER.join(','),
              template: `\`\`\`csv\n${BIRTHDAY_CSV_TEMPLATE}\`\`\``,
            })
          : t('birthday.import.unreadable'),
      );
    }

    const result = await this.birthdays.importRows(
      guildId,
      parsed.rows.map(({ entry }) => entry),
      actorOf(interaction),
    );
    // A student ID the list already holds is reported against the line it came from.
    const lineOf = new Map(parsed.rows.map(({ row, entry }) => [entry.studentId, row]));
    const existing = result.duplicates.flatMap((studentId): BirthdayImportProblem[] => {
      const row = lineOf.get(studentId);
      return row === undefined ? [] : [{ row, kind: 'DUPLICATE_ID', studentId }];
    });
    return answer(
      formatImportReport(t, {
        total: parsed.total,
        added: result.added,
        problems: [...parsed.problems, ...existing],
      }),
    );
  }

  @Subcommand({
    name: 'get-list',
    description: getList['en-US'],
    descriptionLocalizations: getList,
  })
  async onGetList(
    @Context() [interaction]: SlashCommandContext,
    @Options() { month }: GetListOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    // Public, and acknowledged before the read, which can take a while.
    await interaction.reply({ content: t('birthday.list.fetching') });

    const entries = await this.birthdays.list(guildId, month ? { month } : {});
    for (const { text } of formatBirthdayMonths(entries)) await replyInChunks(interaction, text);
    await replyInChunks(interaction, t('birthday.list.done'));
  }

  @Subcommand({ name: 'remove', description: remove['en-US'], descriptionLocalizations: remove })
  async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { studentId, user }: RemoveOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));

    const trimmed = studentId?.trim();
    const result = await this.birthdays.remove(
      guildId,
      { studentId: trimmed === '' ? undefined : trimmed, discordId: user?.id },
      actorOf(interaction),
    );

    const text = {
      REMOVED_BY_STUDENT: t('birthday.remove.removed'),
      REMOVED_BY_USER: t('birthday.remove.removed'),
      NOT_FOUND: t(trimmed ? 'birthday.remove.notFound' : 'birthday.remove.notFoundForUser'),
      NO_SELECTOR: t('birthday.remove.noSelector'),
    }[result.code];
    await replyInChunks(interaction, text, { ephemeral: true });
  }

  /** The same setting as `/set birthday-channel`; both go through the same service call. */
  @Subcommand({
    name: 'birthday-channel',
    description: channel['en-US'],
    descriptionLocalizations: channel,
  })
  async onBirthdayChannel(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel: target }: ChannelOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    // Before the reply is deferred, so a refusal can be private.
    await this.config.assertChannelUsable('birthdayChannelId', target.id);
    await interaction.deferReply();
    await this.config.patch(guildId, { birthdayChannelId: target.id }, actorOf(interaction));
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t('guild-config.set.birthdayChannel', { channel: `<#${target.id}>` }),
    );
  }
}

/** The commands are offered in direct messages too (see AGENTS.md); there is no list there. */
function guildOf(interaction: SlashCommandContext[0]): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

function actorOf(interaction: SlashCommandContext[0]): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}
